/**
 * Throwaway 2-page draft test for the live Studio pipeline.
 *
 * Creates a fresh draft book + StudioProject + 2 pages directly via Prisma
 * (bypassing Clerk auth), seeds a minimal BookBrain with the curated
 * voice "nigerian-storyteller", and enqueues the real VIDEO_GENERATION
 * trigger. Polls until status=REVIEW, then verifies:
 *   1. Both pages have videoUrl + audioUrl + audioStatus=READY.
 *   2. usage_events rows exist for ANIMATE_KICK (one per page) and
 *      NARRATION_KICK (one per page) with provider MINIMAX_VIDEO +
 *      MINIMAX_TTS.
 *
 * After the assertions pass, the script DELETES the book (cascading to
 * StudioProject, Pages, BookBrain, usage_events). It prints "CLEANUP OK"
 * before exit so the run log shows the deletion succeeded.
 *
 * Designed to prove that the runAudioStage voice-id mapping fix works
 * through the normal pipeline without any manual narration re-run.
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { appEnv, isFeatureEnabled } from "../src/config/env.js";
import { enqueuePipeline } from "../src/services/pipeline.js";
import { findVoice, pickProviderVoiceId } from "../src/config/voices.js";

const prisma = new PrismaClient();

if (!isFeatureEnabled("MINIMAX_VIDEO") || !isFeatureEnabled("MINIMAX_TTS")) {
  console.error("[throwaway] MINIMAX_API_KEY not set — refusing to spend");
  process.exit(1);
}
if ((process.env["VIDEO_PROVIDER"] ?? "minimax").toLowerCase().trim() !== "minimax") {
  console.error("[throwaway] VIDEO_PROVIDER != 'minimax'");
  process.exit(1);
}
if ((process.env["TTS_PROVIDER"] ?? "minimax").toLowerCase().trim() !== "minimax") {
  console.error("[throwaway] TTS_PROVIDER != 'minimax'");
  process.exit(1);
}

async function findOwner(): Promise<{ id: string; email: string } | null> {
  for (const email of ["conamsy@gmail.com", "echadmediahouse@gmail.com"]) {
    const u: { id: string; email: string } | null = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true }
    });
    if (u) return u;
  }
  return null;
}

async function main() {
  const owner = await findOwner();
  if (!owner) {
    console.error("[throwaway] no AnimBook user for conamsy@gmail.com / echadmediahouse@gmail.com");
    process.exit(1);
  }

  /* -- 1. Book + StudioProject + Pages (no BookBrain yet — pipeline will
          skip Brain if we don't set one; we'll add a minimal one) -- */
  const slug = `throwaway-pipeline-test-${Date.now().toString(36)}`;
  const book = await prisma.book.create({
    data: {
      slug,
      creatorId: owner.id,
      title: "Throwaway pipeline test",
      subtitle: "Auto-cleaned after the test",
      subcategory: null,
      author: owner.email,
      synopsis: "Verifies runAudioStage picks up the curated voice through the normal pipeline.",
      vertical: "CONSUMER",
      language: "en",
      status: "DRAFT",
      requiresExpertReview: false,
      expertReviewStatus: "NOT_REQUIRED",
      styleId: "painterly-mysticism",
      totalPages: 2
    }
  });
  const project = await prisma.studioProject.create({
    data: {
      ownerId: owner.id,
      bookId: book.id,
      name: "Throwaway pipeline test",
      vertical: "CONSUMER",
      status: "BRAIN_REVIEW",
      currentStage: "BOOK_BRAIN_ANALYSIS",
      expertReviewRequired: false
    }
  });

  const PAGE_TEXT = [
    "The first page tells the story. A single character stands on a hilltop, watching the sun rise over a small village below. The sky is painted in warm oranges and pinks. A gentle wind moves the grass at their feet.",
    "The second page deepens the scene. The character walks slowly down the path toward the village. Lanterns light up in the windows below as dawn breaks. Birdsong fills the air. Everything feels new and full of possibility."
  ];

  const sha = createHash("sha256").update(PAGE_TEXT.join("\n\n")).digest("hex");
  await prisma.page.createMany({
    data: PAGE_TEXT.map((text, idx) => ({
      bookId: book.id,
      pageNum: idx + 1,
      chapter: null,
      textExcerpt: text,
      sourceTextSha256: sha,
      status: "PENDING" as const
    }))
  });

  /* -- 2. Minimal BookBrain with the curated voice pinned -- */
  const voiceId = "nigerian-storyteller"; // curated id, NOT a provider id
  const brain = {
    title: book.title,
    author: book.author,
    genre: ["fiction"],
    cultural_origin: "global",
    target_audience: "general",
    narrative_arc: { setup_pages: [1], climax_pages: [2], resolution_pages: [2] },
    emotional_register: [],
    characters: [],
    settings: [],
    visual_motifs: [],
    pacing_profile: [],
    style_recommendation: "Painterly Mysticism — soft glowing light, gentle mist, rich warm palette",
    page_manifest: []
  };
  await prisma.bookBrain.upsert({
    where: { bookId: book.id },
    create: {
      bookId: book.id,
      genre: brain.genre,
      culturalOrigin: brain.cultural_origin,
      targetAudience: brain.target_audience,
      styleSelected: brain.style_recommendation,
      narratorVoiceId: voiceId,
      rawJson: brain as unknown as object
    },
    update: {
      genre: brain.genre,
      culturalOrigin: brain.cultural_origin,
      targetAudience: brain.target_audience,
      styleSelected: brain.style_recommendation,
      narratorVoiceId: voiceId,
      rawJson: brain as unknown as object
    }
  });

  /* -- 3. Enqueue the normal pipeline -- */
  const jobId = await enqueuePipeline({
    projectId: project.id,
    triggerStage: "VIDEO_GENERATION",
    mode: "full"
  });
  console.log(`[throwaway] setup OK book=${book.id} project=${project.id} jobId=${jobId}`);
  console.log(`[throwaway] voice (curated) = ${voiceId} → provider id = ${pickProviderVoiceId(findVoice(voiceId)) ?? "(null)"}`);

  /* -- 4. Poll until REVIEW (max 25 minutes) -- */
  const startedAt = Date.now();
  const timeoutMs = 25 * 60 * 1000;
  let lastStatus = "";
  while (Date.now() - startedAt < timeoutMs) {
    const fresh = await prisma.studioProject.findUnique({
      where: { id: project.id },
      select: { status: true, currentStage: true }
    });
    if (fresh?.status && fresh.status !== lastStatus) {
      console.log(`[throwaway] poll: status=${fresh.status} stage=${fresh.currentStage}`);
      lastStatus = fresh.status;
    }
    if (fresh?.status === "REVIEW") break;
    await new Promise((r) => setTimeout(r, 20_000));
  }

  /* -- 5. Assertions -- */
  const pages = await prisma.page.findMany({
    where: { bookId: book.id },
    orderBy: { pageNum: "asc" }
  });
  const usage = await prisma.usageEvent.findMany({
    where: { bookId: book.id },
    select: { kind: true, provider: true, units: true, totalUsd: true, pageId: true }
  });
  const totalUsd = usage.reduce((s, r) => s + r.totalUsd, 0);
  const animateKicks = usage.filter((u) => u.kind === "ANIMATE_KICK" && u.provider === "MINIMAX_VIDEO");
  const narrationKicks = usage.filter((u) => u.kind === "NARRATION_KICK" && u.provider === "MINIMAX_TTS");

  const result = {
    bookId: book.id,
    projectId: project.id,
    jobId,
    finalStatus: lastStatus,
    elapsedSec: Math.round((Date.now() - startedAt) / 1000),
    pages: pages.map((p) => ({
      pageNum: p.pageNum,
      hasVideo: !!p.videoUrl,
      hasPoster: !!p.posterUrl,
      hasAudio: !!p.audioUrl,
      hasVtt: !!p.vttUrl,
      audioStatus: p.audioStatus,
      status: p.status
    })),
    usage: {
      animateKicks: animateKicks.length,
      narrationKicks: narrationKicks.length,
      totalUsd,
      byKind: usage.reduce<Record<string, { count: number; usd: number }>>((acc, u) => {
        if (!acc[u.kind]) acc[u.kind] = { count: 0, usd: 0 };
        acc[u.kind].count += 1;
        acc[u.kind].usd += u.totalUsd;
        return acc;
      }, {})
    },
    asserts: {
      videoOnEveryPage: pages.every((p) => !!p.videoUrl),
      audioOnEveryPage: pages.every((p) => !!p.audioUrl && p.audioStatus === "READY"),
      animateKicksPerPage: animateKicks.length === pages.length,
      narrationKicksPerPage: narrationKicks.length === pages.length
    }
  };
  const passed =
    result.asserts.videoOnEveryPage &&
    result.asserts.audioOnEveryPage &&
    result.asserts.animateKicksPerPage &&
    result.asserts.narrationKicksPerPage;
  console.log("\n=== THROWAWAY PIPELINE TEST RESULT ====================================");
  console.log(JSON.stringify(result, null, 2));
  console.log("PASS:", passed);
  console.log("======================================================================");

  /* -- 6. Cleanup -- */
  console.log("[throwaway] cleaning up book " + book.id);
  await prisma.usageEvent.deleteMany({ where: { bookId: book.id } });
  await prisma.page.deleteMany({ where: { bookId: book.id } });
  await prisma.bookBrain.deleteMany({ where: { bookId: book.id } });
  await prisma.studioProject.deleteMany({ where: { bookId: book.id } });
  await prisma.book.delete({ where: { id: book.id } });
  console.log("CLEANUP OK");

  if (!passed) process.exit(2);
}

main()
  .catch((err) => {
    console.error("[throwaway] error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });