/**
 * Reader-selectable narration.
 *
 * GET /api/narration/voices                  — voices readers can pick
 * GET /api/narration/voices/:voice/sample    — short sample (recorded once, then cached)
 * GET /api/narration/pages/:pageId?voice=ID  — narration for one page in that voice
 *
 * Recordings are stored in R2 under a key built from the page, the voice and
 * a hash of the page text, so each page/voice pair is recorded once and then
 * shared by every reader. New recordings are limited per reader per day and
 * account-wide per day to protect the ElevenLabs quota.
 */
import { createHash } from "node:crypto";
import type { Request, Response } from "express";
import { Router } from "express";
import { authMiddleware, requireUserId, type AuthedRequest } from "../../auth/middleware.js";
import { incrementCounter } from "../../cache/index.js";
import { isFeatureEnabled } from "../../config/env.js";
import { findVoice, narratorVoices } from "../../config/voices.js";
import { prisma } from "../../db.js";
import { cdnUrl } from "../../services/cloudflare.js";
import { generateNarration } from "../../services/elevenlabs.js";

export const router = Router();

const DAY = 24 * 60 * 60;
const PER_READER_DAILY = Number(process.env.NARRATION_READER_DAILY_PAGES ?? 60);
const ACCOUNT_DAILY_CHARS = Number(process.env.NARRATION_DAILY_CHAR_CAP ?? 20000);
const SAMPLE_TEXT =
  "Open a page, and watch a world come alive. I will read to you, page by page, for as long as you like.";

const inflight = new Map<string, Promise<string | null>>();

async function exists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
}

/** Return the cached recording, or record it once (deduplicated across requests). */
async function recordOnce(key: string, text: string, elevenVoiceId: string, beforeRecording: () => Promise<void>): Promise<string | null> {
  const url = cdnUrl(key);
  if (!url) return null;
  if (await exists(url)) return url;
  let pending = inflight.get(key);
  if (!pending) {
    pending = (async () => {
      await beforeRecording();
      const result = await generateNarration({ text, voiceId: elevenVoiceId, storageKey: key, strict: true });
      return result.audioUrl;
    })().finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  return pending;
}

class LimitError extends Error {}

async function spend(readerKey: string | null, chars: number): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  if (readerKey) {
    const pages = await incrementCounter(`narration:reader:${readerKey}:${today}`, 1, DAY);
    if (pages > PER_READER_DAILY) throw new LimitError("You've reached today's limit for new voice recordings. Try the book's narrator, or come back tomorrow.");
  }
  const total = await incrementCounter(`narration:chars:${today}`, chars, DAY);
  if (total > ACCOUNT_DAILY_CHARS) throw new LimitError("New voice recordings are paused for today. The book's own narrator still works.");
}

function ready(res: Response): boolean {
  if (isFeatureEnabled("ELEVENLABS") && isFeatureEnabled("CLOUDFLARE")) return true;
  res.status(503).json({ error: "Narration voices are not available right now" });
  return false;
}

router.get("/voices", (_req: Request, res: Response) => {
  res.set("Cache-Control", "public, max-age=300");
  res.json({
    voices: narratorVoices().map((v) => ({ id: v.id, label: v.label, description: v.description })),
    available: isFeatureEnabled("ELEVENLABS") && isFeatureEnabled("CLOUDFLARE")
  });
});

router.get("/voices/:voice/sample", async (req: Request, res: Response) => {
  if (!ready(res)) return;
  const voice = findVoice(String(req.params["voice"] ?? ""));
  if (!voice) {
    res.status(404).json({ error: "Unknown voice" });
    return;
  }
  try {
    const hash = createHash("sha256").update(`${voice.elevenVoiceId}:${SAMPLE_TEXT}`).digest("hex").slice(0, 12);
    const url = await recordOnce(`narration/samples/${voice.id}-${hash}.mp3`, SAMPLE_TEXT, voice.elevenVoiceId, () =>
      spend(null, SAMPLE_TEXT.length)
    );
    if (!url) throw new Error("no url");
    res.json({ voice: voice.id, audioUrl: url });
  } catch (err) {
    res.status(err instanceof LimitError ? 429 : 502).json({ error: err instanceof LimitError ? err.message : "Could not load the sample" });
  }
});

router.get("/pages/:pageId", authMiddleware, async (req: AuthedRequest, res: Response) => {
  if (!ready(res)) return;
  const userId = requireUserId(req);
  const voice = findVoice(typeof req.query.voice === "string" ? req.query.voice : undefined);
  if (!voice) {
    res.status(400).json({ error: "Unknown voice" });
    return;
  }
  const page = await prisma.page.findUnique({
    where: { id: String(req.params["pageId"]) },
    select: { id: true, bookId: true, textExcerpt: true }
  });
  if (!page) {
    res.status(404).json({ error: "Page not found" });
    return;
  }
  const text = page.textExcerpt.trim();
  if (!text) {
    res.json({ pageId: page.id, voice: voice.id, audioUrl: null });
    return;
  }
  try {
    const hash = createHash("sha256").update(`${voice.elevenVoiceId}:${text}`).digest("hex").slice(0, 12);
    const key = `narration/${page.bookId}/${page.id}/${voice.id}-${hash}.mp3`;
    const url = await recordOnce(key, text, voice.elevenVoiceId, () => spend(userId, text.length));
    res.set("Cache-Control", "private, max-age=3600");
    res.json({ pageId: page.id, voice: voice.id, audioUrl: url });
  } catch (err) {
    if (err instanceof LimitError) {
      res.status(429).json({ error: err.message });
      return;
    }
    console.warn(`[narration] ${voice.id} ${page.id}: ${(err as Error).message}`);
    res.status(502).json({ error: "Could not record this page in that voice right now" });
  }
});

export default router;
