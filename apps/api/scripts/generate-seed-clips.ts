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
 *   --force              regenerate pages (and covers) that already have real media
 *   --only cover,1,3     with --book: regenerate exactly these items (implies
 *                        --force for them only; everything else is left alone)
 *   --recast             rewrite the saved cast sheets instead of reusing them
 *
 * Narration (ElevenLabs → R2 MP3 → page.audioUrl)
 *   --audio              also narrate pages that have no narration yet
 *   --audio-only         narrate only (no video, no covers)
 *   --voice <id>         ElevenLabs voice id (else the book's narrator voice,
 *                        else ELEVENLABS_NARRATOR_VOICE_ID, else "Rachel")
 *   --list-voices        print the voices on your ElevenLabs account and exit
 *   --max-chars 25000    narration budget in characters
 *
 * Cast sheets: before generating, Claude reads each book (or the whole World
 * for books that share characters, e.g. Lagos Nights) and writes one fixed
 * description per character — age, build, skin tone, hair, clothing — that is
 * pasted into every cover and page prompt so people look right and stay the
 * same. Sheets are saved to seed-clips-cast.json and reused on later runs.
 */
import "./slow-link-db.js"; // must stay first: lengthens DB timeouts before Prisma loads
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { appEnv, isFeatureEnabled } from "../src/config/env.js";
import { prisma } from "../src/db.js";
import { generateClip, generateStill, estimateClipCredits, type ReferenceImage } from "../src/services/runway.js";
import { mirrorToR2 } from "../src/services/cloudflare.js";
import { characterQuota, generateNarration, listVoices, narratorVoiceId } from "../src/services/elevenlabs.js";

// ---------- args ----------
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string, fallback?: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const DRY = flag("dry-run");
const ONLY_ITEMS = opt("only")?.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const FORCE = flag("force") || Boolean(ONLY_ITEMS);
const RECAST = flag("recast");
const CAST_FILE = "seed-clips-cast.json";
const PORTRAITS = flag("portraits");
const REDO_PORTRAITS = opt("redo-portraits")?.split(",").map((n) => n.trim().toLowerCase()).filter(Boolean);
const APPROVE = flag("approve-portraits");
const APPROVE_NAMES = opt("approve-portraits")?.split(",").map((n) => n.trim().toLowerCase()).filter(Boolean);
const NO_PORTRAITS = flag("no-portraits");
const PORTRAIT_CREDITS = 5;
const AUDIO_ONLY = flag("audio-only");
const AUDIO = AUDIO_ONLY || flag("audio");
const VIDEO = !AUDIO_ONLY;
const VOICE = opt("voice");
const MAX_CHARS = Number(opt("max-chars", "25000"));
const COVERS = !flag("no-covers") && VIDEO;
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

// Named house styles, written so the image model can't drift into photos.
const NAMED_STYLE: Record<string, string> = {
  "painterly-mysticism":
    "painterly illustration with visible brushstrokes, soft glowing light, gentle mist, rich warm palette, dreamlike — a painting, not a photograph",
  "painterly mysticism":
    "painterly illustration with visible brushstrokes, soft glowing light, gentle mist, rich warm palette, dreamlike — a painting, not a photograph",
  "painterly realism":
    "realistic painting with visible brushstrokes, natural light, rich colour — a painting, not a photograph"
};

function resolveStyle(book: BookRow): string {
  const named = [book.worldMembership?.world.styleId, book.brain?.styleSelected]
    .filter((v): v is string => Boolean(v))
    .map((v) => NAMED_STYLE[v.toLowerCase()])
    .find(Boolean);
  return named ?? VERTICAL_STYLE[book.vertical] ?? VERTICAL_STYLE.CONSUMER;
}

// ---------- cast sheets ----------
interface CastMember {
  name: string;
  description: string;
  /** Runway reference tag, e.g. "Adaeze". */
  tag?: string;
  portraitUrl?: string;
  approved?: boolean;
}

interface CastSheet {
  setting: string;
  characters: CastMember[];
}

const CAST_RULES = `You prepare a casting sheet for an illustrated, animated book.
Return ONLY JSON: {"setting": "...", "characters": [{"name": "...", "description": "..."}]} — no markdown.

"setting": one sentence — the real place, era and culture the story happens in.
"characters": every named person (and any recurring unnamed person) in the text. For each, "description" (max 35 words) fixes how they look in every image: sex, approximate age, ethnicity and skin tone, hair, build, and one signature outfit.
Pick ONE specific look for each person — never write 'or' or offer alternatives. Make every character clearly different from the others (hairstyle, outfit colours, build, age). Base ethnicity on the setting and the names given (for example, Igbo or Yoruba names in Lagos mean Nigerian, Black West African people). Do not invent people who are not in the text. If the text names no people, return an empty list.`;

let castCache: Record<string, CastSheet> = {};
if (!RECAST && existsSync(CAST_FILE)) {
  try {
    castCache = JSON.parse(readFileSync(CAST_FILE, "utf8"));
  } catch {
    castCache = {};
  }
}

async function askClaude(system: string, user: string, maxTokens: number): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": String(appEnv.ANTHROPIC_API_KEY),
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: appEnv.ANTHROPIC_BOOK_BRAIN_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }]
    })
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}`);
  const json = (await res.json()) as { content: { type: string; text?: string }[] };
  return json.content.map((c) => c.text ?? "").join("").replace(/```json|```/g, "").trim();
}

/** One sheet per World (shared characters) or per standalone book. */
async function castFor(book: BookRow): Promise<CastSheet | null> {
  const world = book.worldMembership?.world;
  const key = castKey(book);
  if (castCache[key]) {
    ensureTags(castCache[key]);
    return castCache[key];
  }
  if (!USE_CLAUDE) return null;

  const books = world ? world.members.map((m) => m.book) : [book];
  const source = [
    world ? `World "${world.name}": ${world.synopsis}` : "",
    book.worldMembership?.sharedCharacters.length
      ? `Recurring characters: ${book.worldMembership.sharedCharacters.join(", ")}`
      : "",
    book.brain?.culturalOrigin ? `Cultural origin noted by the editor: ${book.brain.culturalOrigin}` : "",
    ...books.map(
      (b) =>
        `Book "${b.title}": ${b.synopsis}\n` + b.pages.map((p) => `- ${p.textExcerpt}`).join("\n")
    )
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const sheet = JSON.parse(await askClaude(CAST_RULES, source, 1200)) as CastSheet;
    if (!Array.isArray(sheet.characters)) throw new Error("no characters list");
    ensureTags(sheet);
    castCache[key] = sheet;
    saveCast();
    console.log(`  cast (${key}): ${sheet.characters.map((c) => c.name).join(", ") || "no named people"}`);
    return sheet;
  } catch (err) {
    console.warn(`  ! cast sheet failed for ${key} (${(err as Error).message}) — continuing without it`);
    return null;
  }
}

function saveCast(): void {
  writeFileSync(CAST_FILE, JSON.stringify(castCache, null, 2));
}

function castKey(book: BookRow): string {
  const world = book.worldMembership?.world;
  return world ? `world:${world.slug}` : `book:${book.slug}`;
}

/** Runway tags: 3–16 chars, letters/digits/underscore, starting with a letter, unique per sheet. */
function ensureTags(cast: CastSheet): void {
  const used = new Set(cast.characters.map((c) => c.tag).filter(Boolean) as string[]);
  for (const c of cast.characters) {
    if (c.tag) continue;
    let base = c.name.normalize("NFKD").replace(/[^A-Za-z0-9]/g, "");
    if (!/^[A-Za-z]/.test(base)) base = `C${base}`;
    base = (base + "Char").slice(0, Math.max(3, Math.min(14, base.length)));
    let tag = base;
    for (let i = 2; used.has(tag); i++) tag = `${base.slice(0, 13)}${i}`;
    used.add(tag);
    c.tag = tag;
  }
}

const squash = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function mentions(text: string, c: CastMember): boolean {
  const flat = ` ${squash(text)} `;
  const first = squash(c.name).split(" ")[0] ?? "";
  if (first.length >= 3 && flat.includes(` ${first} `)) return true;
  // Claude may drop commas or reword slightly — compare the first few words, punctuation-free.
  const head = squash(c.description).split(" ").slice(0, 6).join(" ");
  return head.length > 12 && flat.includes(` ${head} `);
}

/**
 * Which approved portraits to send with a prompt, and the prompt rewritten to
 * mention them (@Tag). Returns the prompt unchanged when nobody appears.
 */
function withReferences(
  prompt: string,
  cast: CastSheet | null,
  style: string,
  named: string[] = []
): { prompt: string; references: ReferenceImage[]; people: string[] } {
  if (NO_PORTRAITS || !cast) return { prompt, references: [], people: [] };
  const listed = new Set(named.map(squash));
  const inFrame = (c: CastMember) =>
    listed.size > 0 ? listed.has(squash(c.name)) || listed.has(squash(c.name).split(" ")[0]) : !/\bno people\b/i.test(prompt) && mentions(prompt, c);
  const people = cast.characters.filter((c) => c.approved && c.portraitUrl && c.tag && inFrame(c)).slice(0, 3);
  if (!people.length) return { prompt, references: [], people: [] };
  const line =
    people.map((c) => `@${c.tag} is ${c.name}`).join("; ") +
    ` — draw ${people.length === 1 ? "this person" : "these people"} with exactly the face, hair, body and clothes shown in the reference image${people.length === 1 ? "" : "s"}.`;
  const rest = prompt.toLowerCase().startsWith(style.slice(0, 20).toLowerCase()) ? prompt.slice(style.length).replace(/^[\s.]+/, "") : prompt;
  return {
    prompt: `${style}. ${line} ${rest}`,
    references: people.map((c) => ({ uri: c.portraitUrl!, tag: c.tag! })),
    people: people.map((c) => c.name)
  };
}

function portraitPrompt(c: CastMember, style: string): string {
  return `${style}. Character reference portrait of exactly one person: ${c.description} Full body visible from head to feet, standing upright and facing the viewer, arms relaxed at the sides, calm neutral expression, soft even light, plain softly blurred background. Only one person in the image. No text, no letters, no logos.`;
}

/** --portraits / --redo-portraits / --approve-portraits. Returns true if it handled the run. */
async function portraitMode(books: BookRow[]): Promise<boolean> {
  if (!PORTRAITS && !REDO_PORTRAITS && !APPROVE) return false;
  const seen = new Map<string, { cast: CastSheet; book: BookRow }>();
  for (const book of books) {
    const key = castKey(book);
    if (seen.has(key)) continue;
    const cast = await castFor(book);
    if (cast) {
      ensureTags(cast);
      seen.set(key, { cast, book });
    }
  }
  saveCast();

  if (APPROVE) {
    let n = 0;
    for (const { cast } of seen.values()) {
      for (const c of cast.characters) {
        if (!c.portraitUrl) continue;
        if (APPROVE_NAMES && !APPROVE_NAMES.includes(c.name.toLowerCase()) && !APPROVE_NAMES.includes((c.tag ?? "").toLowerCase())) continue;
        c.approved = true;
        n++;
      }
    }
    saveCast();
    console.log(`Approved ${n} portrait${n === 1 ? "" : "s"}.`);
  }

  if (PORTRAITS || REDO_PORTRAITS) {
    const todo: Array<{ key: string; c: CastMember; book: BookRow }> = [];
    for (const [key, { cast, book }] of seen) {
      for (const c of cast.characters) {
        const redo = REDO_PORTRAITS?.some((n) => n === c.name.toLowerCase() || n === (c.tag ?? "").toLowerCase());
        if (redo || (PORTRAITS && !c.portraitUrl)) todo.push({ key, c, book });
      }
    }
    const cost = todo.length * PORTRAIT_CREDITS;
    console.log(`\nPortraits to make: ${todo.length} (~${cost} Runway credits)`);
    if (!DRY) {
      if (cost > MAX_CREDITS) throw new Error(`Portraits would cost ~${cost} credits, over --max-credits ${MAX_CREDITS}`);
      for (const { key, c, book } of todo) {
        try {
          const still = await generateStill(portraitPrompt(c, resolveStyle(book)), "720:960");
          const folder = key.replace(/[^a-z0-9-]+/gi, "-");
          const stored = await mirrorToR2(still, `cast/${folder}/${c.tag}-${Date.now().toString(36)}.png`, "image/png");
          c.portraitUrl = stored.url;
          c.approved = false;
          saveCast();
          console.log(`  ✓ ${c.name}`);
        } catch (err) {
          console.warn(`  ✗ ${c.name}: ${(err as Error).message}`);
        }
      }
    }
  }

  // Summary + a contact sheet to look at the faces side by side.
  const rows: string[] = [];
  console.log("\nCast portraits:");
  for (const [key, { cast }] of seen) {
    console.log(`  ${key}`);
    for (const c of cast.characters) {
      const state = !c.portraitUrl ? "no portrait" : c.approved ? "APPROVED" : "waiting for approval";
      console.log(`    ${c.name.padEnd(20)} @${(c.tag ?? "").padEnd(16)} ${state}${c.portraitUrl ? `  ${c.portraitUrl}` : ""}`);
      rows.push(
        `<figure><div class="img">${c.portraitUrl ? `<img src="${c.portraitUrl}" alt="">` : "no portrait"}</div>` +
          `<figcaption><b>${c.name}</b> <span class="${c.approved ? "ok" : "wait"}">${c.approved ? "approved" : c.portraitUrl ? "waiting" : "—"}</span><br><small>${key}</small><p>${c.description}</p></figcaption></figure>`
      );
    }
  }
  const html = `<!doctype html><meta charset="utf-8"><title>AnimBook cast portraits</title><style>body{font-family:system-ui;background:#0b0f17;color:#eee;margin:24px}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:20px}figure{margin:0;background:#141b2a;border-radius:14px;overflow:hidden}.img{aspect-ratio:3/4;display:grid;place-items:center;color:#888}.img img{width:100%;height:100%;object-fit:cover}figcaption{padding:12px 14px;font-size:14px}p{color:#aaa;font-size:12px}.ok{color:#6c6}.wait{color:#e0b13a}</style><h1>Cast portraits</h1><main>${rows.join("")}</main>`;
  writeFileSync("seed-cast-portraits.html", html);
  console.log("\nContact sheet written to seed-cast-portraits.html");
  return true;
}

function castText(cast: CastSheet | null): string {
  if (!cast) return "";
  const people = cast.characters.length
    ? cast.characters.map((c) => `${c.name}: ${c.description}`).join("\n")
    : "(no named people)";
  return `Setting: ${cast.setting}\nCast — copy these descriptions word for word whenever a person appears:\n${people}`;
}

interface PromptPair {
  still: string;
  motion: string;
  /** Cast names Claude says are in the frame. */
  people?: string[];
}

const RULES = `You write prompts for an AI image model and an AI image-to-video model.
Return ONLY JSON: {"still": "...", "motion": "...", "people": ["..."]} — no markdown.
"people" lists the exact cast names of everyone visible in the frame (empty list if nobody).

"still" (max 90 words) starts with the art style exactly as given, then describes one frame: the setting, the exact number of people or creatures in frame (say "one woman", "two men", or "no people"), who is where, what they wear, the light, the camera framing, and the art style given to you. Whenever a person from the cast appears, write their name, then paste their cast description word for word (e.g. "Adaeze, <description>"); only show the people this page is about. If the page is about a place, write "no people". Never ask for written words, signs, captions, logos or letters in the image.

"motion" (max 60 words) describes what moves during a 5-second shot of that frame. State every movement explicitly — which body part moves, in which direction, how far, how fast — and the camera move (e.g. "slow push-in", "static camera"). Tie any effect (light, dust, water, smoke) to the thing that causes it. Repeat the subject count ("the one woman…") so no extra people appear. Keep motion small and physically plausible. No cuts, no new subjects entering.`;

function templatePrompt(book: BookRow, page: PageRow, style: string): PromptPair {
  const scene = page.animationPrompt?.trim() || page.textExcerpt.trim();
  return {
    still: `${style}. ${scene} Scene: ${page.sceneType ?? "establishing"}. Mood: ${page.emotionalRegister ?? "calm"}. Framing: ${
      page.cameraAngle ?? "medium shot"
    }. No text, no letters, no logos.`,
    motion: `Static composition with subtle natural motion only: gentle ambient movement in the environment, slow camera push-in. Mood: ${
      page.emotionalRegister ?? "calm"
    }. No new subjects enter the frame.`
  };
}

async function claudePrompt(book: BookRow, page: PageRow, style: string, cast: CastSheet | null): Promise<PromptPair | null> {
  const user = [
    `Book: "${book.title}" (${book.vertical}) — ${book.synopsis}`,
    `Art style for every page of this book: ${style}`,
    castText(cast),
    book.iconographicNotes ? `Depiction rules for this book: ${book.iconographicNotes}` : "",
    `Page ${page.pageNum}${page.chapter ? ` (${page.chapter})` : ""}: ${page.textExcerpt}`,
    page.animationPrompt ? `Existing art direction: ${page.animationPrompt}` : "",
    `Scene type: ${page.sceneType ?? "-"}; emotion: ${page.emotionalRegister ?? "-"}; camera: ${page.cameraAngle ?? "-"}`
  ]
    .filter(Boolean)
    .join("\n");
  try {
    const parsed = JSON.parse(await askClaude(RULES, user, 700)) as PromptPair;
    if (!parsed.still || !parsed.motion) throw new Error("missing fields");
    return parsed.still.toLowerCase().startsWith(style.slice(0, 20).toLowerCase())
      ? parsed
      : { still: `${style}. ${parsed.still}`, motion: parsed.motion, people: parsed.people };
  } catch (err) {
    console.warn(`  ! prompt writer fell back to template (${(err as Error).message})`);
    return null;
  }
}

const COVER_RULES = `You write one prompt (max 110 words) for a portrait book-cover illustration.
Return ONLY JSON: {"prompt": "...", "people": ["..."]} — no markdown. "people" lists the exact cast names shown.
The prompt starts with the art style exactly as given. Show the story's setting and only the characters the synopsis names — state how many people are in frame, and for each write their name, then paste their cast description word for word. One clear focal image. No text, title, letters or logos.`;

async function coverPrompt(book: BookRow, style: string, cast: CastSheet | null): Promise<{ prompt: string; people?: string[] }> {
  const fallback = `${style}. Book cover artwork for "${book.title}": ${book.synopsis} ${
    cast ? castText(cast) : ""
  } One striking central image, portrait composition, no text, no letters, no title.`;
  if (!USE_CLAUDE) return { prompt: fallback };
  try {
    const text = await askClaude(
      COVER_RULES,
      [`Title: ${book.title}`, `Synopsis: ${book.synopsis}`, `Art style: ${style}`, castText(cast)].filter(Boolean).join("\n"),
      600
    );
    const parsed = JSON.parse(text) as { prompt?: string; people?: string[] };
    return parsed.prompt ? { prompt: parsed.prompt, people: parsed.people } : { prompt: fallback };
  } catch {
    return { prompt: fallback };
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
      brain: { select: { styleSelected: true, culturalOrigin: true, narratorVoiceId: true } },
      worldMembership: {
        select: {
          sharedCharacters: true,
          world: {
            select: {
              slug: true,
              name: true,
              synopsis: true,
              styleId: true,
              members: {
                orderBy: { ordinal: "asc" },
                select: {
                  book: { select: { title: true, synopsis: true, pages: { orderBy: { pageNum: "asc" }, select: { textExcerpt: true } } } }
                }
              }
            }
          }
        }
      },
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
          videoUrl: true,
          audioUrl: true
        }
      }
    }
  });
}
type BookRow = Awaited<ReturnType<typeof loadBooks>>[number];
type PageRow = BookRow["pages"][number];

// ---------- db retry ----------
// Neon's pooler can drop idle connections while we wait minutes on Runway.
// A clip is already paid for by the time we save it, so retry the save
// (reconnecting between attempts) instead of losing it.
async function withDbRetry<T>(label: string, fn: () => Promise<T>, attempts = 6): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const wait = Math.min(30_000, 2_000 * 2 ** i);
      console.warn(`  … ${label}: database unavailable, retrying in ${wait / 1000}s (${i + 1}/${attempts})`);
      await prisma.$disconnect().catch(() => {});
      await new Promise((r) => setTimeout(r, wait));
      await prisma.$connect().catch(() => {});
    }
  }
  throw lastErr;
}

// ---------- run ----------
interface ReportRow {
  book: string;
  page: number | "cover" | `audio-${number}`;
  status: "done" | "failed" | "skipped-budget" | "skipped-portraits";
  videoUrl?: string;
  posterUrl?: string;
  prompt?: string;
  motion?: string;
  /** Cast members whose portraits were sent. */
  references?: string[];
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
  if (flag("list-voices")) {
    const voices = await listVoices();
    for (const v of voices) {
      const labels = v.labels ? Object.values(v.labels).join(", ") : "";
      console.log(`${v.voice_id}  ${v.name.padEnd(28)} ${v.category ?? ""}  ${labels}`);
    }
    return;
  }
  if (!DRY) {
    const missing = [
      VIDEO && !isFeatureEnabled("RUNWAY") && "RUNWAY_API_KEY",
      AUDIO && !isFeatureEnabled("ELEVENLABS") && "ELEVENLABS_API_KEY",
      !isFeatureEnabled("CLOUDFLARE") && "CLOUDFLARE_ACCOUNT_ID / R2 access key / R2 secret",
      !appEnv.CLOUDFLARE_CDN_BASE && "CLOUDFLARE_CDN_BASE"
    ].filter(Boolean);
    if (missing.length) throw new Error(`Missing env: ${missing.join(", ")}`);
  }

  if (ONLY_ITEMS && !ONLY) throw new Error("--only needs --book <slug>");
  const books = await withDbRetry("loading books", () => loadBooks());
  if (await portraitMode(books)) return;
  let pagesPlanned = 0;
  const wanted = (p: PageRow, existing: string | null) =>
    ONLY_ITEMS ? ONLY_ITEMS.includes(String(p.pageNum)) : FORCE || isPlaceholder(existing);
  const plan = books
    .map((book) => {
      const pages = VIDEO ? book.pages.filter((p) => wanted(p, p.videoUrl)) : [];
      const take = pages.slice(0, Math.max(0, LIMIT - pagesPlanned));
      pagesPlanned += take.length;
      const audioPages = AUDIO ? book.pages.filter((p) => wanted(p, p.audioUrl)) : [];
      const cover = !VIDEO
        ? false
        : ONLY_ITEMS
          ? ONLY_ITEMS.includes("cover")
          : COVERS && (FORCE || isPlaceholder(book.coverUrl));
      return { book, pages: take, audioPages, cover };
    })
    .filter((b) => b.pages.length || b.cover || b.audioPages.length);
  const audioCount = plan.reduce((n, b) => n + b.audioPages.length, 0);
  const audioChars = plan.reduce((n, b) => n + b.audioPages.reduce((m, p) => m + p.textExcerpt.trim().length, 0), 0);
  const coverCount = plan.filter((b) => b.cover).length;
  const est = pagesPlanned * PAGE_CREDITS + coverCount * COVER_CREDITS;
  console.log(`\nAnimBook seed media — ${plan.length} books, ${pagesPlanned} clips, ${coverCount} covers, ${audioCount} narrations`);
  if (VIDEO) {
    console.log(`Video: ~${est} Runway credits (~$${(est / 100).toFixed(2)}), ${DURATION}s clips, budget ${MAX_CREDITS}`);
    console.log(`Prompts: ${USE_CLAUDE ? `Claude (${appEnv.ANTHROPIC_BOOK_BRAIN_MODEL})` : "template"}`);
  }
  if (AUDIO) {
    const quota = await characterQuota();
    console.log(
      `Narration: ~${audioChars} ElevenLabs characters, budget ${MAX_CHARS}` +
        (quota ? ` · account has ${quota.limit - quota.used} of ${quota.limit} left this period` : "")
    );
  }
  console.log("");
  for (const { book, pages, cover, audioPages } of plan) {
    const parts = [
      pages.length ? `${pages.length} clips` : "",
      cover ? "cover" : "",
      audioPages.length ? `${audioPages.length} narrations` : ""
    ].filter(Boolean);
    console.log(`  ${book.slug.padEnd(44)} ${parts.join(" + ")}`);
  }
  if (DRY) {
    if (flag("show-cast")) {
      for (const { book } of plan) {
        const cast = await castFor(book);
        console.log(`\n${book.slug} — style: ${resolveStyle(book)}\n${castText(cast) || "(no cast sheet)"}`);
        for (const c of cast?.characters ?? []) {
          console.log(`  portrait ${c.name}: ${!c.portraitUrl ? "none" : c.approved ? "approved" : "waiting for approval"}`);
        }
      }
    }
    return;
  }

  let spent = 0;
  const report: ReportRow[] = [];
  const reserve = (n: number) => {
    if (spent + n > MAX_CREDITS) return false;
    spent += n;
    return true;
  };

  let charsUsed = 0;
  for (const { book, pages, cover, audioPages } of plan) {
    const style = resolveStyle(book);
    console.log(`\n▶ ${book.title}`);
    const cast = VIDEO ? await castFor(book) : null;
    const missingFaces =
      VIDEO && !NO_PORTRAITS && cast ? cast.characters.filter((c) => !(c.approved && c.portraitUrl)).map((c) => c.name) : [];
    const blockVideo = missingFaces.length > 0 && (pages.length > 0 || cover);
    if (blockVideo) {
      console.warn(
        `  ! skipping video for this book — portraits not approved yet for: ${missingFaces.join(", ")}.\n` +
          `    Run with --portraits, check them, then --approve-portraits (or use --no-portraits).`
      );
      report.push({ book: book.slug, page: "cover", status: "skipped-portraits" });
    }

    if (cover && !blockVideo) {
      if (!reserve(COVER_CREDITS)) {
        report.push({ book: book.slug, page: "cover", status: "skipped-budget" });
      } else {
        try {
          const written = await coverPrompt(book, style, cast);
          const coverRef = withReferences(written.prompt, cast, style, written.people);
          const prompt = coverRef.prompt;
          const still = await generateStill(prompt, "720:960", coverRef.references);
          const stored = await mirrorToR2(still, `books/${book.slug}/cover-${Date.now().toString(36)}.png`, "image/png");
          await withDbRetry("cover save", () =>
            prisma.book.update({ where: { id: book.id }, data: { coverUrl: stored.url } })
          );
          report.push({ book: book.slug, page: "cover", status: "done", posterUrl: stored.url, prompt, references: coverRef.people });
          if (coverRef.people.length) console.log(`    faces: ${coverRef.people.join(", ")}`);
          console.log("  ✓ cover");
        } catch (err) {
          report.push({ book: book.slug, page: "cover", status: "failed", error: (err as Error).message });
          console.warn(`  ✗ cover: ${(err as Error).message}`);
        }
      }
    }

    await pool<PageRow>(blockVideo ? [] : pages, CONCURRENCY, async (page) => {
      if (!reserve(PAGE_CREDITS)) {
        report.push({ book: book.slug, page: page.pageNum, status: "skipped-budget" });
        return;
      }
      const written = (USE_CLAUDE && (await claudePrompt(book, page, style, cast))) || templatePrompt(book, page, style);
      const referenced = withReferences(written.still, cast, style, written.people);
      const prompts = { still: referenced.prompt, motion: written.motion };
      try {
        const clip = await generateClip({
          projectId: book.id,
          pageNum: page.pageNum,
          prompt: prompts.still,
          motionPrompt: prompts.motion,
          negativePrompt: page.negativePrompt ?? undefined,
          durationSeconds: DURATION,
          storagePrefix: `books/${book.slug}`,
          strict: true,
          references: referenced.references
        });
        try {
          await withDbRetry(`p${page.pageNum} save`, () =>
            prisma.page.update({
              where: { id: page.id },
              data: {
                videoUrl: clip.videoUrl,
                posterUrl: clip.posterUrl,
                animationPrompt: page.animationPrompt ?? prompts.still,
                qualityScore: 0.85,
                status: "APPROVED"
              }
            })
          );
        } catch (dbErr) {
          // Keep the paid-for URLs in the report so they can be restored by hand.
          report.push({
            book: book.slug,
            page: page.pageNum,
            status: "failed",
            videoUrl: clip.videoUrl,
            posterUrl: clip.posterUrl,
            error: `generated but not saved: ${(dbErr as Error).message.slice(0, 200)}`
          });
          console.warn(`  ✗ p${page.pageNum}: generated but not saved — URLs kept in report`);
          return;
        }
        report.push({
          book: book.slug,
          page: page.pageNum,
          status: "done",
          videoUrl: clip.videoUrl,
          posterUrl: clip.posterUrl,
          prompt: prompts.still,
          motion: prompts.motion,
          references: referenced.people
        });
        console.log(`  ✓ p${page.pageNum}${referenced.people.length ? ` (faces: ${referenced.people.join(", ")})` : ""}`);
      } catch (err) {
        report.push({
          book: book.slug,
          page: page.pageNum,
          status: "failed",
          error: (err as Error).message,
          prompt: prompts.still,
          motion: prompts.motion,
          references: referenced.people
        });
        console.warn(`  ✗ p${page.pageNum}: ${(err as Error).message}`);
      }
    });

    const voice = VOICE ?? narratorVoiceId(book.brain?.narratorVoiceId);
    for (const page of audioPages) {
      const text = page.textExcerpt.trim();
      if (charsUsed + text.length > MAX_CHARS) {
        report.push({ book: book.slug, page: `audio-${page.pageNum}`, status: "skipped-budget" });
        continue;
      }
      charsUsed += text.length;
      try {
        const narration = await generateNarration({
          text,
          voiceId: voice,
          storageKey: `books/${book.slug}/p${page.pageNum}-voice-${Date.now().toString(36)}.mp3`,
          strict: true
        });
        await withDbRetry(`p${page.pageNum} narration save`, () =>
          prisma.page.update({ where: { id: page.id }, data: { audioUrl: narration.audioUrl, vttUrl: null } })
        );
        report.push({ book: book.slug, page: `audio-${page.pageNum}`, status: "done", videoUrl: narration.audioUrl ?? undefined });
        console.log(`  ✓ p${page.pageNum} narration`);
      } catch (err) {
        report.push({ book: book.slug, page: `audio-${page.pageNum}`, status: "failed", error: (err as Error).message });
        console.warn(`  ✗ p${page.pageNum} narration: ${(err as Error).message}`);
      }
    }
  }

  const file = `seed-clips-report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(file, JSON.stringify({ spentEstimate: spent, narrationCharacters: charsUsed, report }, null, 2));
  const done = report.filter((r) => r.status === "done").length;
  const failed = report.filter((r) => r.status === "failed").length;
  const skipped = report.filter((r) => r.status === "skipped-budget").length;
  console.log(`\nDone ${done} · failed ${failed} · skipped for budget ${skipped} · ~${spent} Runway credits · ${charsUsed} narration characters. Report: ${file}`);
  if (failed) console.log("Re-run the same command to retry failures — finished pages are skipped.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
