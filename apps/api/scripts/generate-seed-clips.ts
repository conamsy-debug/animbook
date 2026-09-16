/**
 * Replace placeholder media on seeded AnimBooks with real Runway clips.
 *
 *   npx tsx apps/api/scripts/generate-seed-clips.ts --dry-run
 *   npx tsx apps/api/scripts/generate-seed-clips.ts --book the-night-train
 *   npx tsx apps/api/scripts/generate-seed-clips.ts --max-credits 6000
 *
 * Needs the API's env: DATABASE_URL, RUNWAY_API_KEY, CLOUDFLARE_ACCOUNT_ID,
 * CLOUDFLARE_R2_ACCESS_KEY_ID, CLOUDFLARE_R2_SECRET_ACCESS_KEY,
 * CLOUDFLARE_R2_BUCKET, CLOUDFLARE_CDN_BASE, and (optional, for better
 * prompts) ANTHROPIC_API_KEY. Easiest: `railway run -s <api service> -- …`.
 *
 * Safe to re-run: pages that already have a real clip are skipped, and each
 * page is written to the database only after its files are in R2.
 *
 * Flags
 *   --dry-run            list what would be generated and the credit estimate
 *   --book a,b           only these book slugs
 *   --limit N            stop after N pages
 *   --duration 5         clip length in seconds (2–10)
 *   --concurrency 2      pages generated at once
 *   --max-credits 6000   hard budget; stops before exceeding it
 *   --no-covers          leave placeholder covers alone
 *   --no-claude          use the template prompt instead of Claude
 *   --force              regenerate pages that already have real clips
 */
import { writeFileSync } from "node:fs";
import { appEnv, isFeatureEnabled } from "../src/config/env.js";
import { prisma } from "../src/db.js";
import { generateClip, generateStill, estimateClipCredits } from "../src/services/runway.js";
import { mirrorToR2 } from "../src/services/cloudflare.js";

// ---------- args ----------
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string, fallback?: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const DRY = flag("dry-run");
const FORCE = flag("force");
const COVERS = !flag("no-covers");
const USE_CLAUDE = !flag("no-claude") && isFeatureEnabled("BOOK_BRAIN");
const ONLY = opt("book")?.split(",").map((s) => s.trim()).filter(Boolean);
const LIMIT = Number(opt("limit", "0")) || Infinity;
const DURATION = Math.min(10, Math.max(2, Number(opt("duration", "5"))));
const CONCURRENCY = Math.max(1, Number(opt("concurrency", "2")));
const MAX_CREDITS = Number(opt("max-credits", "6000"));
const COVER_CREDITS = 5;
const PAGE_CREDITS = estimateClipCredits(DURATION);

const isPlaceholder = (url: string | null | undefined) =>
  !url || url.includes("placehold.co") || url.startsWith("data:") || url.includes("animbook.r2.dev");

// ---------- style ----------
const VERTICAL_STYLE: Record<string, string> = {
  CONSUMER: "cinematic painterly realism, rich warm light, shallow depth of field",
  ORIGINALS: "cinematic painterly realism, bold composition, dramatic light",
  KIDS: "soft storybook illustration, rounded shapes, warm pastel palette, gentle and safe, no peril",
  EDU: "clean educational illustration, clear shapes, bright even light, uncluttered background",
  FAITH: "reverent classical painting style, soft golden light, dignified and respectful",
  DOCS: "clear realistic instructional footage look, even daylight, hands and tools clearly visible",
  VERSE: "dreamlike lyrical painting, flowing color, poetic atmosphere",
  COMICS: "bold inked comic-art look, strong outlines, flat vivid color",
  BUSINESS: "clean modern corporate illustration, calm palette, clear subjects",
  WELLNESS: "slow calm atmosphere, muted soft palette, gentle natural light",
  LAW: "clear documentary realism, neutral palette, civic settings",
  TRAVEL: "documentary travel cinematography, natural light, sense of place"
};

interface PromptPair {
  still: string;
  motion: string;
}

const RULES = `You write prompts for an AI image model and an AI image-to-video model.
Return ONLY JSON: {"still": "...", "motion": "..."} — no markdown.

"still" (max 70 words) describes one frame: the setting, the exact number of people or creatures in frame (say "one woman", "two men", or "no people"), who is where, what they wear, the light, the camera framing, and the art style given to you. Never ask for written words, signs, captions, logos or letters in the image.

"motion" (max 60 words) describes what moves during a 5-second shot of that frame. State every movement explicitly — which body part moves, in which direction, how far, how fast — and the camera move (e.g. "slow push-in", "static camera"). Tie any effect (light, dust, water, smoke) to the thing that causes it. Repeat the subject count ("the one woman…") so no extra people appear. Keep motion small and physically plausible. No cuts, no new subjects entering.`;

function templatePrompt(book: BookRow, page: PageRow, style: string): PromptPair {
  const scene = page.animationPrompt?.trim() || page.textExcerpt.trim();
  return {
    still: `${scene} Scene: ${page.sceneType ?? "establishing"}. Mood: ${page.emotionalRegister ?? "calm"}. Framing: ${
      page.cameraAngle ?? "medium shot"
    }. Style: ${style}. No text, no letters, no logos.`,
    motion: `Static composition with subtle natural motion only: gentle ambient movement in the environment, slow camera push-in. Mood: ${
      page.emotionalRegister ?? "calm"
    }. No new subjects enter the frame.`
  };
}

async function claudePrompt(book: BookRow, page: PageRow, style: string): Promise<PromptPair | null> {
  const body = {
    model: appEnv.ANTHROPIC_BOOK_BRAIN_MODEL,
    max_tokens: 600,
    system: RULES,
    messages: [
      {
        role: "user",
        content: [
          `Book: "${book.title}" (${book.vertical}) — ${book.synopsis}`,
          `Art style for every page of this book: ${style}`,
          book.iconographicNotes ? `Depiction rules for this book: ${book.iconographicNotes}` : "",
          `Page ${page.pageNum}${page.chapter ? ` (${page.chapter})` : ""}: ${page.textExcerpt}`,
          page.animationPrompt ? `Existing art direction: ${page.animationPrompt}` : "",
          `Scene type: ${page.sceneType ?? "-"}; emotion: ${page.emotionalRegister ?? "-"}; camera: ${page.cameraAngle ?? "-"}`
        ]
          .filter(Boolean)
          .join("\n")
      }
    ]
  };
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": String(appEnv.ANTHROPIC_API_KEY),
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}`);
    const json = (await res.json()) as { content: { type: string; text?: string }[] };
    const text = json.content.map((c) => c.text ?? "").join("").replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(text) as PromptPair;
    if (!parsed.still || !parsed.motion) throw new Error("missing fields");
    return { still: `${parsed.still} Style: ${style}.`, motion: parsed.motion };
  } catch (err) {
    console.warn(`  ! prompt writer fell back to template (${(err as Error).message})`);
    return null;
  }
}

// ---------- data ----------
async function loadBooks() {
  return prisma.book.findMany({
    where: { status: "PUBLISHED", ...(ONLY ? { slug: { in: ONLY } } : {}) },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      slug: true,
      title: true,
      synopsis: true,
      vertical: true,
      coverUrl: true,
      iconographicNotes: true,
      brain: { select: { styleSelected: true } },
      pages: {
        orderBy: { pageNum: "asc" },
        select: {
          id: true,
          pageNum: true,
          chapter: true,
          textExcerpt: true,
          animationPrompt: true,
          negativePrompt: true,
          sceneType: true,
          emotionalRegister: true,
          cameraAngle: true,
          videoUrl: true
        }
      }
    }
  });
}
type BookRow = Awaited<ReturnType<typeof loadBooks>>[number];
type PageRow = BookRow["pages"][number];

// ---------- run ----------
interface ReportRow {
  book: string;
  page: number | "cover";
  status: "done" | "failed" | "skipped-budget";
  videoUrl?: string;
  posterUrl?: string;
  error?: string;
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    })
  );
}

async function main() {
  if (!DRY) {
    const missing = [
      !isFeatureEnabled("RUNWAY") && "RUNWAY_API_KEY",
      !isFeatureEnabled("CLOUDFLARE") && "CLOUDFLARE_ACCOUNT_ID / R2 access key / R2 secret",
      !appEnv.CLOUDFLARE_CDN_BASE && "CLOUDFLARE_CDN_BASE"
    ].filter(Boolean);
    if (missing.length) throw new Error(`Missing env: ${missing.join(", ")}`);
  }

  const books = await loadBooks();
  let pagesPlanned = 0;
  const plan = books
    .map((book) => {
      const pages = book.pages.filter((p) => FORCE || isPlaceholder(p.videoUrl));
      const take = pages.slice(0, Math.max(0, LIMIT - pagesPlanned));
      pagesPlanned += take.length;
      return { book, pages: take, cover: COVERS && isPlaceholder(book.coverUrl) };
    })
    .filter((b) => b.pages.length || b.cover);

  const coverCount = plan.filter((b) => b.cover).length;
  const est = pagesPlanned * PAGE_CREDITS + coverCount * COVER_CREDITS;
  console.log(`\nAnimBook seed clips — ${plan.length} books, ${pagesPlanned} pages, ${coverCount} covers`);
  console.log(`Estimate: ~${est} Runway credits (~$${(est / 100).toFixed(2)}), ${DURATION}s clips, budget ${MAX_CREDITS}`);
  console.log(`Prompts: ${USE_CLAUDE ? `Claude (${appEnv.ANTHROPIC_BOOK_BRAIN_MODEL})` : "template"}\n`);
  for (const { book, pages, cover } of plan) {
    console.log(`  ${book.slug.padEnd(44)} ${String(pages.length).padStart(3)} pages${cover ? " + cover" : ""}`);
  }
  if (DRY) return;

  let spent = 0;
  const report: ReportRow[] = [];
  const reserve = (n: number) => {
    if (spent + n > MAX_CREDITS) return false;
    spent += n;
    return true;
  };

  for (const { book, pages, cover } of plan) {
    const style = book.brain?.styleSelected
      ? `${book.brain.styleSelected}; ${VERTICAL_STYLE[book.vertical] ?? VERTICAL_STYLE.CONSUMER}`
      : VERTICAL_STYLE[book.vertical] ?? VERTICAL_STYLE.CONSUMER;
    console.log(`\n▶ ${book.title}`);

    if (cover) {
      if (!reserve(COVER_CREDITS)) {
        report.push({ book: book.slug, page: "cover", status: "skipped-budget" });
      } else {
        try {
          const coverPrompt = `Book cover artwork for "${book.title}": ${book.synopsis} One striking central image, portrait composition, no text, no letters, no title. Style: ${style}.`;
          const still = await generateStill(coverPrompt, "720:960");
          const stored = await mirrorToR2(still, `books/${book.slug}/cover-${Date.now().toString(36)}.png`, "image/png");
          await prisma.book.update({ where: { id: book.id }, data: { coverUrl: stored.url } });
          report.push({ book: book.slug, page: "cover", status: "done", posterUrl: stored.url });
          console.log("  ✓ cover");
        } catch (err) {
          report.push({ book: book.slug, page: "cover", status: "failed", error: (err as Error).message });
          console.warn(`  ✗ cover: ${(err as Error).message}`);
        }
      }
    }

    await pool<PageRow>(pages, CONCURRENCY, async (page) => {
      if (!reserve(PAGE_CREDITS)) {
        report.push({ book: book.slug, page: page.pageNum, status: "skipped-budget" });
        return;
      }
      const prompts = (USE_CLAUDE && (await claudePrompt(book, page, style))) || templatePrompt(book, page, style);
      try {
        const clip = await generateClip({
          projectId: book.id,
          pageNum: page.pageNum,
          prompt: prompts.still,
          motionPrompt: prompts.motion,
          negativePrompt: page.negativePrompt ?? undefined,
          durationSeconds: DURATION,
          storagePrefix: `books/${book.slug}`,
          strict: true
        });
        await prisma.page.update({
          where: { id: page.id },
          data: {
            videoUrl: clip.videoUrl,
            posterUrl: clip.posterUrl,
            animationPrompt: page.animationPrompt ?? prompts.still,
            qualityScore: 0.85,
            status: "APPROVED"
          }
        });
        report.push({ book: book.slug, page: page.pageNum, status: "done", videoUrl: clip.videoUrl, posterUrl: clip.posterUrl });
        console.log(`  ✓ p${page.pageNum}`);
      } catch (err) {
        report.push({ book: book.slug, page: page.pageNum, status: "failed", error: (err as Error).message });
        console.warn(`  ✗ p${page.pageNum}: ${(err as Error).message}`);
      }
    });
  }

  const file = `seed-clips-report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(file, JSON.stringify({ spentEstimate: spent, report }, null, 2));
  const done = report.filter((r) => r.status === "done").length;
  const failed = report.filter((r) => r.status === "failed").length;
  const skipped = report.filter((r) => r.status === "skipped-budget").length;
  console.log(`\nDone ${done} · failed ${failed} · skipped for budget ${skipped} · ~${spent} credits. Report: ${file}`);
  if (failed) console.log("Re-run the same command to retry failures — finished pages are skipped.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
