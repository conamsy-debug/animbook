// Per-author voice cloning. Mounted at /api/account/voice.
// Audits consent (legal: cloning someone's voice requires proof they
// agreed), drops the audio in R2 (kept for re-train or audit), and
// delegates the actual cloning to ElevenLabs.
import { Router, type Response } from "express";
import express from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { authMiddleware, requireUserId, type AuthedRequest } from "../../auth/middleware.js";
import { rateLimit } from "../../middleware/rateLimit.js";
import { uploadAsset } from "../../services/cloudflare.js";
import { cloneVoiceFromSamples, deleteClonedVoice, synthesizeSpeech } from "../../services/elevenlabs.js";
import { PREVIEW_SENTENCE, scoreVoiceQuality, type VoiceQualityReport } from "../../services/voiceQuality.js";

const router = Router();
router.use(authMiddleware);

/**
 * 25MB raw audio body. Used only on POST / — the other routes are
 * JSON-only and unaffected.
 */
const rawAudioBody = express.raw({ type: () => true, limit: "26mb" });

/**
 * GET /api/account/voice — return the current author's voice status.
 * Public shape, no PII besides userId (the caller owns this row).
 */
router.get("/", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      narratorVoiceId: true,
      voiceStatus: true,
      voiceSampleUrl: true,
      voiceSampleUrls: true,
      voiceConsentAt: true,
      voiceFailureReason: true,
      voiceQualityScore: true,
      voiceQualityDetails: true,
      voiceQualityComputedAt: true
    }
  });
  if (!user) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  res.json({
    hasVoice: Boolean(user.narratorVoiceId) && user.voiceStatus === "CLONED",
    voiceId: user.narratorVoiceId,
    status: user.voiceStatus,
    sampleUrl: user.voiceSampleUrl,
    sampleUrls: user.voiceSampleUrls,
    consentAt: user.voiceConsentAt,
    failureReason: user.voiceFailureReason,
    quality: user.voiceQualityScore !== null ? {
      score: user.voiceQualityScore,
      details: user.voiceQualityDetails,
      computedAt: user.voiceQualityComputedAt
    } : null
  });
});

/**
 * POST /api/account/voice — single-file legacy route. Streams raw audio
 * with consent + name in headers. Kept for backwards compat with any
 * existing single-file clients (the UI now uses /samples). Logic shared
 * with `cloneAndPersist()` below.
 *
 * Headers:
 *   x-voice-name:  short label for the cloned voice (required)
 *   x-voice-consent: "true" — confirms the speaker is the author and agrees
 *                    to ElevenLabs cloning these samples.
 *   x-filename:    optional, defaults to "voice-samples.mp3"
 *   content-type:  audio/mpeg, audio/wav, audio/mp4, audio/x-m4a
 */
router.post(
  "/",
  rateLimit({ name: "account.voice.clone", max: 8, windowSeconds: 3600 }),
  rawAudioBody,
  async (req: AuthedRequest, res: Response) => {
    const userId = requireUserId(req);
    const consentHeader = String(req.headers["x-voice-consent"] ?? "");
    if (consentHeader !== "true") {
      res.status(400).json({ error: "Missing x-voice-consent: true header" });
      return;
    }
    const voiceName = String(req.headers["x-voice-name"] ?? "").trim();
    if (voiceName.length < 2 || voiceName.length > 80) {
      res.status(400).json({ error: "x-voice-name must be 2-80 characters" });
      return;
    }
    const body = req.body as Buffer | undefined;
    if (!Buffer.isBuffer(body) || body.byteLength === 0) {
      res.status(400).json({ error: "Empty audio upload" });
      return;
    }
    if (body.byteLength > 25 * 1024 * 1024) {
      res.status(413).json({ error: "Audio upload exceeds 25MB" });
      return;
    }
    const contentType = String(req.headers["content-type"] ?? "audio/mpeg");
    const ext = contentType.includes("wav")
      ? "wav"
      : contentType.includes("mp4") || contentType.includes("m4a")
        ? "m4a"
        : "mp3";
    const consentIp = consentIpFromHeaders(req);
    const result = await cloneAndPersist({
      userId,
      voiceName,
      consentIp,
      samples: [{ buffer: body, filename: `sample.${ext}`, contentType }]
    });
    res.status(result.status).json(result.body);
  }
);

/* --------------------------------------------------------------------- *
 * POST /api/account/voice/samples — multi-file clone via JSON envelope.
 *
 * Body (application/json):
 *   {
 *     "name": "Cosmos storyteller",
 *     "consent": true,
 *     "samples": [
 *       { "filename": "intro.mp3",  "contentType": "audio/mpeg",
 *         "base64": "<base64 of the audio bytes>" },
 *       …
 *     ]
 *   }
 *
 * Why JSON-envelope and not multipart? express.raw doesn't parse
 * multipart, and adding busboy/multer just for this one route is heavier
 * than the JSON route. base64 is 33% bloat but voice samples are small
 * (≤12MB each, total ≤40MB JSON) and the simplicity is worth it.
 *
 * ElevenLabs accepts up to ~25 samples; we cap at 8 here (1.5–5 minutes
 * of speech is the sweet spot for Instant Clone) and require ≥1.
 * --------------------------------------------------------------------- */

const samplesSchema = z.object({
  name: z.string().trim().min(2).max(80),
  consent: z.literal(true),
  samples: z.array(z.object({
    filename: z.string().min(1).max(120),
    contentType: z.string().regex(/^audio\//, "must be audio/*"),
    base64: z.string().min(8)
  })).min(1).max(8)
});

const MAX_SAMPLE_BYTES = 12 * 1024 * 1024;
const MAX_TOTAL_BYTES = 40 * 1024 * 1024;

router.post(
  "/samples",
  rateLimit({ name: "account.voice.clone", max: 8, windowSeconds: 3600 }),
  express.json({ limit: "45mb" }),
  async (req: AuthedRequest, res: Response) => {
    const userId = requireUserId(req);
    const parsed = samplesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid envelope",
        detail: parsed.error.errors.slice(0, 5).map((e) => `${e.path.join(".")}: ${e.message}`)
      });
      return;
    }
    const samples: { buffer: Buffer; filename: string; contentType: string }[] = [];
    let totalBytes = 0;
    for (const s of parsed.data.samples) {
      const buf = Buffer.from(s.base64, "base64");
      if (buf.byteLength === 0) {
        res.status(400).json({ error: `Sample ${s.filename} is empty` });
        return;
      }
      if (buf.byteLength > MAX_SAMPLE_BYTES) {
        res.status(413).json({
          error: `Sample ${s.filename} is ${(buf.byteLength / 1024 / 1024).toFixed(1)}MB; max is 12MB each`
        });
        return;
      }
      totalBytes += buf.byteLength;
      if (totalBytes > MAX_TOTAL_BYTES) {
        res.status(413).json({ error: "Combined samples exceed 30MB audio (40MB JSON-encoded)" });
        return;
      }
      samples.push({ buffer: buf, filename: s.filename, contentType: s.contentType });
    }
    const consentIp = consentIpFromHeaders(req);
    const result = await cloneAndPersist({
      userId,
      voiceName: parsed.data.name,
      consentIp,
      samples
    });
    res.status(result.status).json(result.body);
  }
);

/* --------------------------------------------------------------------- *
 * POST /api/account/voice/preview — synthesize a sample sentence in the
 * user's cloned voice so they can hear it before narrating a real book.
 * Returns the audio URL + the duration so the UI can render a play
 * button + a "your clone took 4.2s to say this" hint.
 *
 * Only works when the user has a CLONED voice. Rate-limited so a
 * curious author can't burn credits.
 * --------------------------------------------------------------------- */

const previewSchema = z.object({
  /** Optional override of the default preview sentence. */
  text: z.string().min(1).max(240).optional(),
  /** Optional voice id override — defaults to the user's clone. */
  voiceId: z.string().min(3).max(80).optional()
});

router.post(
  "/preview",
  rateLimit({ name: "account.voice.preview", max: 12, windowSeconds: 3600 }),
  express.json({ limit: "8kb" }),
  async (req: AuthedRequest, res: Response) => {
    const userId = requireUserId(req);
    const parsed = previewSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid preview payload" });
      return;
    }
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { narratorVoiceId: true, voiceStatus: true }
    });
    if (!user) {
      res.status(404).json({ error: "Account not found" });
      return;
    }
    const voiceId = parsed.data.voiceId ?? user.narratorVoiceId;
    if (!voiceId || user.voiceStatus !== "CLONED") {
      res.status(409).json({
        error: "No cloned voice yet. Upload samples and clone first.",
        voiceStatus: user.voiceStatus
      });
      return;
    }
    const text = parsed.data.text ?? PREVIEW_SENTENCE;
    const startedAt = Date.now();
    try {
      const audio = await synthesizeSpeech(text, voiceId);
      const storageKey = `voice-previews/${userId}-${Date.now().toString(36)}.mp3`;
      const stored = await uploadAsset({ key: storageKey, body: audio, contentType: "audio/mpeg" });
      res.json({
        audioUrl: stored.url,
        text,
        voiceId,
        characters: text.length,
        synthMs: Date.now() - startedAt,
        cacheControl: "private, max-age=300"
      });
    } catch (err) {
      const reason = (err as Error).message.slice(0, 240);
      res.status(502).json({ error: `Could not synthesise preview: ${reason}` });
    }
  }
);

/* --------------------------------------------------------------------- *
 * GET /api/account/voice/quality — return the latest quality report
 * for this author's clone. Returns null when no clone exists yet or
 * when quality hasn't been computed (legacy single-file uploads).
 *
 * The full score lives on the user record; we rebuild a normalised
 * VoiceQualityReport from the stored JSON so the UI gets the same shape
 * regardless of source (samples-pipeline vs. legacy single-file).
 * --------------------------------------------------------------------- */

router.get("/quality", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      voiceStatus: true,
      voiceQualityScore: true,
      voiceQualityDetails: true,
      voiceQualityComputedAt: true,
      voiceSampleUrls: true
    }
  });
  if (!user) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  if (user.voiceQualityScore === null || !user.voiceQualityDetails) {
    res.json({
      voiceStatus: user.voiceStatus,
      quality: null,
      hint: "No quality score yet — clone a voice with at least one sample to see one."
    });
    return;
  }
  res.json({
    voiceStatus: user.voiceStatus,
    quality: {
      score: user.voiceQualityScore,
      details: user.voiceQualityDetails,
      computedAt: user.voiceQualityComputedAt
    }
  });
});

/* --------------------------------------------------------------------- *
 * DELETE /api/account/voice — remove this author's cloned voice. Caller
 * keeps the consent trail (voice_consent_at) but the voice is gone and
 * narration falls back to the curated default.
 * --------------------------------------------------------------------- */

router.delete("/", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { narratorVoiceId: true }
  });
  if (!user?.narratorVoiceId) {
    res.status(404).json({ error: "No cloned voice to remove" });
    return;
  }
  await deleteClonedVoice(user.narratorVoiceId);
  await prisma.user.update({
    where: { id: userId },
    data: { narratorVoiceId: null, voiceStatus: "REMOVED", voiceFailureReason: null }
  });
  res.json({ ok: true });
});

/* --------------------------------------------------------------------- *
 * Shared helpers
 * --------------------------------------------------------------------- */

function consentIpFromHeaders(req: AuthedRequest): string | null {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string") {
    return fwd.split(",")[0]!.trim().slice(0, 64);
  }
  return req.ip ?? null;
}

interface CloneArgs {
  userId: string;
  voiceName: string;
  consentIp: string | null;
  samples: { buffer: Buffer; filename: string; contentType: string }[];
}

interface CloneResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Shared clone pipeline used by both the legacy single-file POST / and
 * the new multi-file POST /samples.
 *
 * Steps:
 *   1. Park each sample in R2 (preserves the consent trail even if
 *      ElevenLabs rejects).
 *   2. Mark the user UPLOADING.
 *   3. Call cloneVoiceFromSamples with the full list.
 *   4. Persist the new voiceId; auto-delete the previous clone on
 *      ElevenLabs (best-effort).
 *   5. Compute quality score and persist it.
 *   6. Return the public shape (voiceId, sampleUrls, quality).
 */
async function cloneAndPersist(args: CloneArgs): Promise<CloneResult> {
  const { userId, voiceName, consentIp, samples } = args;

  // 1. Park each sample in R2.
  const storedSamples: { url: string; filename: string; contentType: string }[] = [];
  for (const s of samples) {
    const ext = s.contentType.includes("wav")
      ? "wav"
      : s.contentType.includes("mp4") || s.contentType.includes("m4a")
        ? "m4a"
        : "mp3";
    const key = `voice-samples/${userId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
    try {
      const stored = await uploadAsset({ key, body: s.buffer, contentType: s.contentType });
      storedSamples.push({ url: stored.url, filename: s.filename, contentType: s.contentType });
    } catch (err) {
      return {
        status: 502,
        body: { error: `Could not store ${s.filename}: ${(err as Error).message.slice(0, 200)}` }
      };
    }
  }

  // 2. Mark the user UPLOADING.
  const previous = await prisma.user.findUnique({
    where: { id: userId },
    select: { narratorVoiceId: true }
  });
  await prisma.user.update({
    where: { id: userId },
    data: {
      voiceStatus: "UPLOADING",
      voiceSampleUrl: storedSamples[0]?.url ?? null,
      voiceSampleUrls: storedSamples,
      voiceConsentAt: new Date(),
      voiceConsentIp: consentIp,
      voiceFailureReason: null,
      // Invalidate the old quality score — samples changed.
      voiceQualityScore: null,
      voiceQualityDetails: null,
      voiceQualityComputedAt: null
    }
  });

  // 3. Hand off to ElevenLabs.
  try {
    const { voiceId } = await cloneVoiceFromSamples({
      name: voiceName,
      description: `AnimBook author voice · ${voiceName}`,
      labels: { source: "animbook-author-clone" },
      samples: samples.map((s) => ({
        buffer: s.buffer,
        filename: s.filename,
        contentType: s.contentType
      }))
    });

    if (previous?.narratorVoiceId && previous.narratorVoiceId !== voiceId) {
      void deleteClonedVoice(previous.narratorVoiceId);
    }

    // 4. Persist voice id immediately so the UI flips to CLONED.
    await prisma.user.update({
      where: { id: userId },
      data: { narratorVoiceId: voiceId, voiceStatus: "CLONED", voiceFailureReason: null }
    });

    // 5. Compute quality score and persist it. Best-effort — if ffprobe
    //    is missing or audio metadata is unreadable we still record the
    //    best partial score we can.
    let quality: VoiceQualityReport | null = null;
    try {
      quality = await scoreVoiceQuality(
        samples.map((s) => ({ buffer: s.buffer, filename: s.filename }))
      );
      await prisma.user.update({
        where: { id: userId },
        data: {
          voiceQualityScore: quality.score,
          voiceQualityDetails: quality as unknown as object,
          voiceQualityComputedAt: new Date()
        }
      });
    } catch (qualityErr) {
      console.warn(`[account-voice] quality scoring failed for ${userId}: ${(qualityErr as Error).message}`);
    }

    return {
      status: 201,
      body: {
        voiceId,
        status: "CLONED",
        sampleUrl: storedSamples[0]?.url ?? null,
        sampleUrls: storedSamples,
        quality: quality
          ? {
              score: quality.score,
              details: quality,
              computedAt: new Date().toISOString()
            }
          : null
      }
    };
  } catch (err) {
    const reason = (err as Error).message.slice(0, 500);
    await prisma.user.update({
      where: { id: userId },
      data: { voiceStatus: "FAILED", voiceFailureReason: reason }
    });
    return { status: 502, body: { error: reason } };
  }
}

export default router;
