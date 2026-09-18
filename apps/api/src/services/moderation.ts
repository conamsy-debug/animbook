/**
 * Screening for anything a reader writes (notes, circle posts, messages).
 *
 * Claude classifies the text; if that isn't available we fall back to a
 * conservative word check. Nothing a reader writes is published without
 * passing through here, and anything uncertain is held for review rather
 * than shown.
 */
import { appEnv, isFeatureEnabled } from "../config/env.js";

export type Verdict = "allow" | "review" | "block";

export interface Screening {
  verdict: Verdict;
  reason?: string;
}

const SYSTEM = `You screen short messages readers write on a reading platform used by adults, and by children in schools.
Answer with ONE JSON object: {"verdict":"allow"|"review"|"block","reason":"<10 words"}.
block: sexual content involving minors, grooming or requests for a child's personal details, threats or incitement of violence, hate against a protected group, doxxing (phone numbers, addresses), scams, or explicit sexual content.
review: insults, harassment, self-harm talk, contact details, links to unknown sites, or anything you are unsure about.
allow: ordinary discussion of the book, opinions, questions, praise, criticism.
JSON only.`;

const HARD_BLOCK = [
  /\b(kill|rape|hurt)\s+(you|him|her|them|yourself)\b/i,
  /\bchild\s*(porn|sex)\b/i,
  /\bsend\s+(me\s+)?(nudes|pics of you)\b/i
];
const HOLD = [
  /\b\+?\d[\d\s().-]{7,}\d\b/, // phone numbers
  /\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b/i, // email addresses
  /\bhttps?:\/\//i, // links
  /\b(whatsapp|telegram|snapchat|signal me)\b/i,
  /\b(kill myself|end it all|suicide|self.harm)\b/i
];

function offline(text: string): Screening {
  if (HARD_BLOCK.some((re) => re.test(text))) return { verdict: "block", reason: "unsafe content" };
  if (HOLD.some((re) => re.test(text))) return { verdict: "review", reason: "contact details or link" };
  return { verdict: "allow" };
}

export async function screenText(text: string, context?: string): Promise<Screening> {
  const trimmed = text.trim();
  if (!trimmed) return { verdict: "block", reason: "empty" };
  const quick = offline(trimmed);
  if (quick.verdict === "block") return quick;
  if (!isFeatureEnabled("BOOK_BRAIN")) return quick;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": String(appEnv.ANTHROPIC_API_KEY),
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: appEnv.ANTHROPIC_BOOK_BRAIN_MODEL,
        max_tokens: 100,
        system: SYSTEM,
        messages: [{ role: "user", content: context ? `Context: ${context}\n\nMessage: ${trimmed}` : trimmed }]
      })
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}`);
    const json = (await res.json()) as { content: { text?: string }[] };
    const raw = json.content.map((c) => c.text ?? "").join("").replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(raw) as Screening;
    if (parsed.verdict === "allow" || parsed.verdict === "review" || parsed.verdict === "block") {
      // The offline check can only make the verdict stricter, never looser.
      if (quick.verdict === "review" && parsed.verdict === "allow") return quick;
      return parsed;
    }
  } catch (err) {
    console.warn(`[moderation] falling back to word check: ${(err as Error).message}`);
  }
  return quick;
}

/** Status a new piece of writing gets from its screening. */
export function statusFor(screening: Screening): "VISIBLE" | "HELD" {
  return screening.verdict === "allow" ? "VISIBLE" : "HELD";
}
