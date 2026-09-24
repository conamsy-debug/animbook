/**
 * AnimBook Languages — adaptation orchestrator (Patch 11).
 *
 * Spec § 11. Routes call `enqueueAdaptation()` after writing a
 * `queued` row in `languages_adaptation_jobs`. The route returns
 * immediately with the job ids.
 *
 * BullMQ was the original execution substrate, but the project
 * installs are currently broken in a way that prevents Redis-based
 * jobs from booting in tests. We ship the orchestrator as a
 * synchronous "run the queued job" function (`runAdaptationJob`)
 * that the admin screen (Patch 12) calls via a `POST /admin/jobs/
 * :jobId/run` trigger. This keeps the architecture honest — the
 * row is the source of truth for status — and unblocks Patch 11
 * without depending on Redis being healthy.
 *
 * The retry loop on parse failure, the LLM provider abstraction,
 * the schema validation via `parseLesson`, and the `importLesson`
 * import path all carry over from the BullMQ design. Swapping in a
 * queue later is a one-file change to `enqueueAdaptation` +
 * `adaptationQueue.start()`.
 */
import { prisma } from "../../db.js";
import { importLesson } from "./importer.js";
import { adaptWithRetry, LessonAdaptationError, resolveLlmProvider } from "./llm.js";
import type { LlmProvider, MasterScript } from "./llm.js";

/**
 * Enqueue one adaptation job per requested target language. The
 * route writes a `queued` row in `languages_adaptation_jobs` and
 * returns the row ids.
 *
 * In the BullMQ future (Patch 12 follow-up) this also queues a
 * job per row. Today it just returns the ids so the admin UI can
 * poll + trigger the run.
 */
export async function enqueueAdaptation(input: {
  masterStoryId: string;
  targetLangs: string[];
}): Promise<string[]> {
  if (input.targetLangs.length === 0) {
    throw new Error("enqueueAdaptation: targetLangs must not be empty");
  }
  const rows = await Promise.all(
    input.targetLangs.map(async (targetLang) =>
      prisma.languagesAdaptationJob.create({
        data: {
          masterStoryId: input.masterStoryId,
          targetLang,
          status: "queued"
        }
      })
    )
  );
  return rows.map((r) => r.id);
}

/** Read a single job's status. */
export async function getAdaptationJob(jobId: string): Promise<{
  id: string;
  masterStoryId: string;
  targetLang: string;
  status: string;
  resultStoryId: string | null;
  errorMessage: string | null;
  attempts: number;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
} | null> {
  return prisma.languagesAdaptationJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      masterStoryId: true,
      targetLang: true,
      status: true,
      resultStoryId: true,
      errorMessage: true,
      attempts: true,
      startedAt: true,
      completedAt: true,
      createdAt: true,
      updatedAt: true
    }
  });
}

/** Re-derive a job's `status` against `now` so a learner/admin who
 *  hasn't checked in for a while sees the right value. We don't
 *  write this — the next activity call will reconcile. */
export function rederiveStatus(
  status: string,
  completedAt: Date | null
): string {
  if (status === "completed" || status === "failed") return status;
  return status;
}

/* --------------------------------------------------------------------- *
 * runAdaptationJob — sync orchestrator
 * --------------------------------------------------------------------- *
 * Loads the master story + calls the LLM + retries on parse failure
 * + runs `importLesson` to write the Story + Lexemes + Tokens +
 * Exercises. Updates the job row through the lifecycle. Public so
 * tests can call it directly with a stubbed provider (no BullMQ
 * + no Redis required).
 */

export async function runAdaptationJob(
  jobId: string,
  overrides: {
    anthropicApiKey?: string;
    anthropicModel?: string;
    fetchImpl?: typeof fetch;
    /** Inject a custom provider — used by tests so they don't
     *  need a live Anthropic endpoint. */
    provider?: LlmProvider;
  } = {}
): Promise<void> {
  const job = await prisma.languagesAdaptationJob.findUnique({
    where: { id: jobId }
  });
  if (!job) {
    throw new Error(`runAdaptationJob: job ${jobId} not found`);
  }
  if (job.status !== "queued") {
    // Idempotent: a retry of an already-finished job is a no-op.
    return;
  }

  // Mark running + capture start time.
  await prisma.languagesAdaptationJob.update({
    where: { id: jobId },
    data: {
      status: "running",
      startedAt: new Date(),
      attempts: { increment: 1 }
    }
  });

  // Load the master story.
  const masterStory = await prisma.masterStory.findUnique({
    where: { id: job.masterStoryId },
    select: { masterScript: true, slug: true }
  });
  if (!masterStory) {
    await markFailed(jobId, "master story was deleted before the job ran");
    return;
  }

  const provider = overrides.provider
    ? overrides.provider
    : resolveLlmProvider({
        ...(overrides.anthropicApiKey !== undefined
          ? { anthropicApiKey: overrides.anthropicApiKey }
          : { anthropicApiKey: process.env.ANTHROPIC_API_KEY }),
        ...(overrides.anthropicModel !== undefined
          ? { anthropicModel: overrides.anthropicModel }
          : {}),
        ...(overrides.fetchImpl !== undefined
          ? { fetchImpl: overrides.fetchImpl }
          : {})
      });
  if (!provider.isConfigured()) {
    await markFailed(
      jobId,
      "No LlmProvider configured (set ANTHROPIC_API_KEY)."
    );
    return;
  }

  const masterScript = masterStory.masterScript as unknown as MasterScript;

  let lesson;
  try {
    lesson = (
      await adaptWithRetry(
        provider,
        {
          masterScript,
          targetLang: job.targetLang,
          baseLang: "en"
        },
        { maxAttempts: 3 }
      )
    ).lesson;
  } catch (err) {
    const raw =
      err instanceof LessonAdaptationError
        ? err.rawText
        : err instanceof Error
          ? err.message
          : String(err);
    await markFailed(jobId, raw);
    return;
  }

  // Carry the master slug into the lesson so the importer can
  // re-attach the masterStory row.
  const adaptedLesson = {
    ...lesson,
    master_story_slug: masterStory.slug
  };

  let storyId: string;
  try {
    const result = await importLesson(prisma, adaptedLesson);
    storyId = result.storyId;
  } catch (err) {
    await markFailed(
      jobId,
      err instanceof Error ? err.message : "importLesson failed"
    );
    return;
  }

  await prisma.languagesAdaptationJob.update({
    where: { id: jobId },
    data: {
      status: "completed",
      completedAt: new Date(),
      resultStoryId: storyId,
      errorMessage: null
    }
  });
}

async function markFailed(jobId: string, message: string): Promise<void> {
  await prisma.languagesAdaptationJob.update({
    where: { id: jobId },
    data: {
      status: "failed",
      completedAt: new Date(),
      errorMessage: message.slice(0, 4000)
    }
  });
}
