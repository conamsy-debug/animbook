/**
 * AnimBook Languages — admin review service (Patch 12).
 *
 * Spec § 11 admin endpoints. The HTTP routes call through this module
 * so the route file stays focused on auth + serialization. Functions:
 *
 *   - listStoriesForReview()    — GET /admin/stories?status=in_review
 *   - getStoryForReview()       — GET /admin/stories/:id (deep detail)
 *   - editStory()               — PUT /admin/stories/:id (text + translations + audio URLs)
 *   - regenerateLineAudio()     — POST /admin/lines/:id/regenerate-audio
 *   - approveStory()            — POST /admin/stories/:id/approve
 *   - rejectStory()             — POST /admin/stories/:id/reject
 *
 * The story detail shape includes scenes → lines → exercises so the
 * review screen renders one tree without further round-trips. Audio
 * regeneration picks the language's configured voice for the line's
 * speaker (narrator vs. character).
 */
import { prisma } from "../../db.js";
import {
  pickVoiceForSpeaker,
  resolveTtsProvider
} from "./tts.js";

/* --------------------------------------------------------------------- *
 * Shape types — what the routes return on the wire
 * --------------------------------------------------------------------- */

export interface ReviewStorySummary {
  id: string;
  masterStoryId: string;
  targetLang: string;
  title: string;
  titleTranslations: Record<string, string>;
  cefrLevel: string;
  reviewStatus: string;
  reviewerId: string | null;
  reviewerNotes: string | null;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
  masterStoryTitle: string;
}

export interface ReviewStoryDetail extends ReviewStorySummary {
  scenes: Array<{
    id: string;
    order: number;
    lines: Array<{
      id: string;
      order: number;
      speaker: string;
      text: string;
      textReading: string | null;
      translations: { en: string; fr: string } | null;
      audioUrl: string | null;
      startMs: number | null;
      endMs: number | null;
      wordTimings: unknown;
    }>;
    exercises: Array<{
      id: string;
      order: number;
      type: string;
      payload: unknown;
      answer: unknown;
    }>;
  }>;
}

/* --------------------------------------------------------------------- *
 * listStoriesForReview
 * --------------------------------------------------------------------- */

export interface ListStoriesOptions {
  status?: string;
  targetLang?: string;
  limit?: number;
}

export async function listStoriesForReview(
  opts: ListStoriesOptions = {}
): Promise<ReviewStorySummary[]> {
  const where: Record<string, unknown> = {};
  if (opts.status) where["reviewStatus"] = opts.status;
  if (opts.targetLang) where["targetLang"] = opts.targetLang;

  const rows = await prisma.story.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: Math.min(opts.limit ?? 50, 200),
    select: {
      id: true,
      masterStoryId: true,
      targetLang: true,
      title: true,
      titleTranslations: true,
      cefrLevel: true,
      reviewStatus: true,
      reviewerId: true,
      reviewerNotes: true,
      isPublished: true,
      createdAt: true,
      updatedAt: true,
      masterStory: { select: { titleEn: true } }
    }
  });

  return rows.map((r) => ({
    id: r.id,
    masterStoryId: r.masterStoryId,
    targetLang: r.targetLang,
    title: r.title,
    titleTranslations: (r.titleTranslations ?? {}) as Record<string, string>,
    cefrLevel: r.cefrLevel,
    reviewStatus: r.reviewStatus,
    reviewerId: r.reviewerId,
    reviewerNotes: r.reviewerNotes,
    isPublished: r.isPublished,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    masterStoryTitle: r.masterStory.titleEn
  }));
}

/* --------------------------------------------------------------------- *
 * getStoryForReview — deep detail
 * --------------------------------------------------------------------- */

export async function getStoryForReview(
  storyId: string
): Promise<ReviewStoryDetail | null> {
  const story = await prisma.story.findUnique({
    where: { id: storyId },
    select: {
      id: true,
      masterStoryId: true,
      targetLang: true,
      title: true,
      titleTranslations: true,
      cefrLevel: true,
      reviewStatus: true,
      reviewerId: true,
      reviewerNotes: true,
      isPublished: true,
      createdAt: true,
      updatedAt: true,
      masterStory: { select: { titleEn: true } },
      scenes: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          order: true,
          lines: {
            orderBy: { order: "asc" },
            select: {
              id: true,
              order: true,
              speaker: true,
              text: true,
              textReading: true,
              translations: true,
              audioUrl: true,
              startMs: true,
              endMs: true,
              wordTimings: true
            }
          },
          exercises: {
            orderBy: { order: "asc" },
            select: {
              id: true,
              order: true,
              type: true,
              payload: true,
              answer: true
            }
          }
        }
      }
    }
  });
  if (!story) return null;

  return {
    id: story.id,
    masterStoryId: story.masterStoryId,
    targetLang: story.targetLang,
    title: story.title,
    titleTranslations: (story.titleTranslations ?? {}) as Record<string, string>,
    cefrLevel: story.cefrLevel,
    reviewStatus: story.reviewStatus,
    reviewerId: story.reviewerId,
    reviewerNotes: story.reviewerNotes,
    isPublished: story.isPublished,
    createdAt: story.createdAt.toISOString(),
    updatedAt: story.updatedAt.toISOString(),
    masterStoryTitle: story.masterStory.titleEn,
    scenes: story.scenes.map((s) => ({
      id: s.id,
      order: s.order,
      lines: s.lines.map((l) => ({
        id: l.id,
        order: l.order,
        speaker: l.speaker,
        text: l.text,
        textReading: l.textReading,
        translations: (l.translations ?? null) as { en: string; fr: string } | null,
        audioUrl: l.audioUrl,
        startMs: l.startMs,
        endMs: l.endMs,
        wordTimings: l.wordTimings
      })),
      exercises: s.exercises.map((e) => ({
        id: e.id,
        order: e.order,
        type: e.type,
        payload: e.payload,
        answer: e.answer
      }))
    }))
  };
}

/* --------------------------------------------------------------------- *
 * editStory — PUT /admin/stories/:id
 *
 * Edits allowed:
 *   - title (string)
 *   - titleTranslations (object)
 *   - lines: Array<{ id, text?, textReading?, translations?, audioUrl?, startMs?, endMs? }>
 *   - reviewerNotes (string)
 *
 * Note: when the admin edits `audioUrl` directly the orchestrator skips
 * TTS regeneration. When they edit `text` but leave audioUrl alone,
 * the audio will sound stale until they hit "regenerate audio" on the
 * line. We intentionally don't auto-regenerate here — audio regen costs
 * ElevenLabs credits and should be an explicit action.
 * --------------------------------------------------------------------- */

export interface EditStoryInput {
  title?: string;
  titleTranslations?: Record<string, string>;
  reviewerNotes?: string;
  lines?: Array<{
    id: string;
    text?: string;
    textReading?: string | null;
    translations?: { en?: string; fr?: string } | null;
    audioUrl?: string | null;
    startMs?: number | null;
    endMs?: number | null;
  }>;
}

export async function editStory(
  storyId: string,
  patch: EditStoryInput
): Promise<ReviewStoryDetail | null> {
  const story = await prisma.story.findUnique({ where: { id: storyId } });
  if (!story) return null;

  await prisma.$transaction(async (tx) => {
    const data: Record<string, unknown> = {};
    if (typeof patch.title === "string") data["title"] = patch.title;
    if (patch.titleTranslations) data["titleTranslations"] = patch.titleTranslations;
    if (typeof patch.reviewerNotes === "string") {
      data["reviewerNotes"] = patch.reviewerNotes;
    }
    if (Object.keys(data).length > 0) {
      await tx.story.update({ where: { id: storyId }, data });
    }
    if (Array.isArray(patch.lines)) {
      for (const ln of patch.lines) {
        const lineData: Record<string, unknown> = {};
        if (typeof ln.text === "string") lineData["text"] = ln.text;
        if (typeof ln.textReading === "string" || ln.textReading === null) {
          lineData["textReading"] = ln.textReading;
        }
        if (ln.translations !== undefined) lineData["translations"] = ln.translations;
        if (typeof ln.audioUrl === "string" || ln.audioUrl === null) {
          lineData["audioUrl"] = ln.audioUrl;
        }
        if (typeof ln.startMs === "number" || ln.startMs === null) {
          lineData["startMs"] = ln.startMs;
        }
        if (typeof ln.endMs === "number" || ln.endMs === null) {
          lineData["endMs"] = ln.endMs;
        }
        if (Object.keys(lineData).length > 0) {
          await tx.line.update({ where: { id: ln.id }, data: lineData });
        }
      }
    }
  });

  return getStoryForReview(storyId);
}

/* --------------------------------------------------------------------- *
 * regenerateLineAudio
 * --------------------------------------------------------------------- */

export interface RegenerateAudioResult {
  lineId: string;
  audioUrl: string | null;
  source: "elevenlabs" | "stub";
  characters: number;
  voiceId: string | null;
}

export async function regenerateLineAudio(
  lineId: string
): Promise<RegenerateAudioResult | null> {
  const line = await prisma.line.findUnique({
    where: { id: lineId },
    select: {
      id: true,
      speaker: true,
      text: true,
      scene: {
        select: {
          story: {
            select: {
              id: true,
              targetLang: true
            }
          }
        }
      }
    }
  });
  if (!line) return null;

  const targetLang = line.scene.story.targetLang;
  const voiceId = await pickVoiceForSpeaker(targetLang, line.speaker);
  const storageKey = `lang-audio/${targetLang}/${line.scene.story.id}/${line.id}.mp3`;

  const provider = resolveTtsProvider();
  const result = await provider.synthesize({
    text: line.text,
    voiceId,
    storageKey,
    strict: false
  });

  await prisma.line.update({
    where: { id: line.id },
    data: { audioUrl: result.audioUrl }
  });

  return {
    lineId: line.id,
    audioUrl: result.audioUrl,
    source: result.source,
    characters: result.characters,
    voiceId
  };
}

/* --------------------------------------------------------------------- *
 * approveStory / rejectStory
 * --------------------------------------------------------------------- */

export async function approveStory(
  storyId: string,
  reviewerId: string
): Promise<ReviewStorySummary | null> {
  const story = await prisma.story.findUnique({ where: { id: storyId } });
  if (!story) return null;
  await prisma.story.update({
    where: { id: storyId },
    data: {
      reviewStatus: "approved",
      reviewerId,
      isPublished: true,
      updatedAt: new Date()
    }
  });
  const list = await listStoriesForReview({ status: "approved" });
  return list.find((s) => s.id === storyId) ?? null;
}

export async function rejectStory(
  storyId: string,
  reviewerId: string,
  notes: string
): Promise<ReviewStorySummary | null> {
  const story = await prisma.story.findUnique({ where: { id: storyId } });
  if (!story) return null;
  await prisma.story.update({
    where: { id: storyId },
    data: {
      reviewStatus: "rejected",
      reviewerId,
      reviewerNotes: notes.slice(0, 4000),
      isPublished: false,
      updatedAt: new Date()
    }
  });
  const list = await listStoriesForReview({ status: "rejected" });
  return list.find((s) => s.id === storyId) ?? null;
}
