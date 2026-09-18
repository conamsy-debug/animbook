// Per-author voice cloning. Mounted at /api/account/voice.
// Audits consent (legal: cloning someone's voice requires proof they
// agreed), drops the audio in R2 (kept for re-train or audit), and
// delegates the actual cloning to ElevenLabs.
import { Router, type Response } from "express";
import express from "express";
import { prisma } from "../../db.js";
import { authMiddleware, requireUserId, type AuthedRequest } from "../../auth/middleware.js";
import { rateLimit } from "../../middleware/rateLimit.js";
import { uploadAsset } from "../../services/cloudflare.js";
import { cloneVoiceFromSamples, deleteClonedVoice } from "../../services/elevenlabs.js";

const router = Router();
router.use(authMiddleware);

/**
 * 25MB raw audio body. Used only on POST / — the other two routes are
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
      voiceConsentAt: true,
      voiceFailureReason: true
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
    consentAt: user.voiceConsentAt,
    failureReason: user.voiceFailureReason
  });
});

/**
 * POST /api/account/voice — upload audio sample(s) + consent, run clone.
 * Multipart upload via express.raw → manual parse to extract the JSON
 * metadata header + audio buffer(s).
 *
 * Headers:
 *   x-voice-name:  short label for the cloned voice (required)
 *   x-voice-consent: "true" — confirms the speaker is the author and agrees
 *                    to ElevenLabs cloning these samples.
 *   x-filename:    optional, defaults to "voice-samples.mp3"
 *   content-type:  audio/mpeg, audio/wav, audio/mp4, audio/x-m4a
 *
 * Limits: one multipart payload ≤ 25MB containing one or more audio files.
 * ElevenLabs accepts multipart `files` parts; we send them as a single blob
 * (the caller concatenates client-side) for simplicity.
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
    const consentIp = typeof req.headers["x-forwarded-for"] === "string"
      ? req.headers["x-forwarded-for"].split(",")[0]!.trim().slice(0, 64)
      : req.ip ?? null;

    // 1. Park the audio in R2 first — even if cloning fails, the consent
    //    trail and the raw sample are preserved.
    const contentType = String(req.headers["content-type"] ?? "audio/mpeg");
    const ext = contentType.includes("wav")
      ? "wav"
      : contentType.includes("mp4") || contentType.includes("m4a")
        ? "m4a"
        : "mp3";
    const sampleKey = `voice-samples/${userId}-${Date.now().toString(36)}.${ext}`;
    let sampleUrl: string;
    try {
      const stored = await uploadAsset({ key: sampleKey, body, contentType });
      sampleUrl = stored.url;
    } catch (err) {
      res.status(502).json({ error: `Could not store the sample: ${(err as Error).message.slice(0, 200)}` });
      return;
    }

    // 2. Mark the user as UPLOADING while we call ElevenLabs.
    const previousVoiceId = (await prisma.user.findUnique({ where: { id: userId }, select: { narratorVoiceId: true } }))?.narratorVoiceId;
    await prisma.user.update({
      where: { id: userId },
      data: {
        voiceStatus: "UPLOADING",
        voiceSampleUrl: sampleUrl,
        voiceConsentAt: new Date(),
        voiceConsentIp: consentIp,
        voiceFailureReason: null
      }
    });

    // 3. Hand the audio off to ElevenLabs.
    try {
      const { voiceId } = await cloneVoiceFromSamples({
        name: voiceName,
        description: `AnimBook author voice · ${voiceName}`,
        labels: { source: "animbook-author-clone" },
        samples: [{ buffer: body, filename: `sample.${ext}`, contentType }]
      });

      // 4. Persist the new voice id. If the user had a previous clone, ask
      //    ElevenLabs to drop the old one (best-effort — failure is logged).
      if (previousVoiceId && previousVoiceId !== voiceId) {
        void deleteClonedVoice(previousVoiceId);
      }
      await prisma.user.update({
        where: { id: userId },
        data: { narratorVoiceId: voiceId, voiceStatus: "CLONED", voiceFailureReason: null }
      });
      res.status(201).json({ voiceId, status: "CLONED", sampleUrl });
    } catch (err) {
      const reason = (err as Error).message.slice(0, 500);
      await prisma.user.update({
        where: { id: userId },
        data: { voiceStatus: "FAILED", voiceFailureReason: reason }
      });
      res.status(502).json({ error: reason });
    }
  }
);

/**
 * DELETE /api/account/voice — remove this author's cloned voice. Caller
 * keeps the consent trail (voice_consent_at) but the voice is gone and
 * narration falls back to the curated default.
 */
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

export default router;
