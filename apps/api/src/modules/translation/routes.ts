/**
 * AnimBook LIVE TRANSLATION — word-level translation lookup.
 *
 * Phase 1: maintain a curated glossary in the TranslationGloss table.
 * Phase 2 (when the GPT-4o key is set): fall back to GPT-4o for translation.
 *
 * The reader's tap-word selection hits this endpoint and surfaces the
 * translation + pronunciation + an example sentence.
 */
import type { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import { authMiddleware } from "../../auth/middleware.js";
import { prisma } from "../../db.js";
import { isFeatureEnabled } from "../../config/env.js";

const router = Router();
router.use(authMiddleware);

const lookupSchema = z.object({
  word: z.string().min(1).max(64),
  sourceLang: z.string().min(2).max(8),
  targetLang: z.string().min(2).max(8),
  bookId: z.string().optional()
});

router.post("/lookup", async (req: Request, res: Response) => {
  const parsed = lookupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid lookup", details: parsed.error.flatten() });
    return;
  }
  const word = parsed.data.word.toLowerCase();
  const direct = await prisma.translationGloss.findUnique({
    where: { sourceLang_targetLang_word: { sourceLang: parsed.data.sourceLang, targetLang: parsed.data.targetLang, word } }
  });
  if (direct) {
    res.json({ source: direct, fallback: false });
    return;
  }
  if (isFeatureEnabled("OPENAI")) {
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: "Return JSON: { translation, pronunciation, exampleSentence }." },
            {
              role: "user",
              content: `Translate "${parsed.data.word}" from ${parsed.data.sourceLang} to ${parsed.data.targetLang}. Provide pronunciation in IPA when useful.`
            }
          ],
          response_format: { type: "json_object" }
        })
      });
      if (response.ok) {
        const json = (await response.json()) as { choices?: { message?: { content?: string } }[] };
        const content = json.choices?.[0]?.message?.content ?? "{}";
        const parsedBody = JSON.parse(content) as { translation: string; pronunciation?: string; exampleSentence?: string };
        const persisted = await prisma.translationGloss.create({
          data: {
            sourceLang: parsed.data.sourceLang,
            targetLang: parsed.data.targetLang,
            word,
            translation: parsedBody.translation,
            pronunciation: parsedBody.pronunciation ?? null,
            exampleSentence: parsedBody.exampleSentence ?? null,
            bookId: parsed.data.bookId ?? null
          }
        });
        res.json({ source: persisted, fallback: false });
        return;
      }
    } catch (err) {
      console.warn("[translation] GPT-4o fallback failed:", (err as Error).message);
    }
  }
  res.json({
    source: {
      sourceLang: parsed.data.sourceLang,
      targetLang: parsed.data.targetLang,
      word,
      translation: `[${parsed.data.targetLang}] translation of "${parsed.data.word}"`,
      pronunciation: null,
      exampleSentence: null
    },
    fallback: true
  });
});

export default router;