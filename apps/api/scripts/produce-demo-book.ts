/**
 * One-shot orchestrator — produce the YC/Techstars demo book
 * "The Book That Learned to Speak" through the real Studio path.
 *
 * Source: the-book-that-learned-to-speak.md (10 pages with NARRATION +
 * SCENE + a Cast block). No app code change. Drives Prisma directly to
 * bypass Clerk auth, then enqueues the production pipeline queue so the
 * real Studio worker (on the live Railway API server) does the rest:
 *
 *   runGeneration → buildPrompts → runVideoStage → runAudioStage
 *
 * Each video step goes through `services/minimax-video.ts` (VIDEO_PROVIDER
 * = minimax, model MiniMax-Hailuo-2.3, 6s/768P). Each audio step goes
 * through `services/minimax-speech.ts` (TTS_PROVIDER = minimax,
 * speech-2.8-hd). No probe scripts in this path — production code only.
 *
 * Hard cap = $6 USD total. Pre-flight estimate: 10 pages × $0.28
 * (Hailuo-2.3 768P 6s) + ~$0.11 narration (≈1100 chars × $100/M) +
 * $0.035 posters (image-01) ≈ $2.95. Comfortably below the cap.
 *
 * After enqueue, polls the StudioProject status every 30s for up to
 * 45 minutes (10 clips in parallel pairs ≈ 30 min, +narrate ≈ +2 min).
 * When status="REVIEW" the run is done; pulls per-page clip + audio
 * status + cost rows from `usage_events` and prints a single JSON report.
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { PrismaClient, type BookVertical } from "@prisma/client";
import { appEnv, isFeatureEnabled } from "../src/config/env.js";
import { enqueuePipeline } from "../src/services/pipeline.js";
import {
  MINIMAX_VIDEO_USD_768P_6S,
  MINIMAX_TTS_USD_PER_1M_CHARS_HD,
  estimateMinimaxTtsCostUsd
} from "../src/services/usageTracking.js";

const prisma = new PrismaClient();

/* --------------------------------------------------------------------- *
 * Guards
 * --------------------------------------------------------------------- */

function fail(message: string): never {
  console.error("[produce-demo] " + message);
  process.exit(1);
}

if (!isFeatureEnabled("MINIMAX_VIDEO") || !isFeatureEnabled("MINIMAX_TTS")) {
  fail("MINIMAX_API_KEY not set — refusing to spend against the fallback.");
}
if ((process.env["VIDEO_PROVIDER"] ?? "minimax").toLowerCase().trim() !== "minimax") {
  fail("VIDEO_PROVIDER is not 'minimax' — this orchestrator is MiniMax-only.");
}
if ((process.env["TTS_PROVIDER"] ?? "minimax").toLowerCase().trim() !== "minimax") {
  fail("TTS_PROVIDER is not 'minimax' — this orchestrator is MiniMax-only.");
}
if (!isFeatureEnabled("CLOUDFLARE")) {
  fail("R2 not configured — uploads will be no-op stubs. Set CLOUDFLARE_* first.");
}

/* --------------------------------------------------------------------- *
 * Owner lookup
 * --------------------------------------------------------------------- */

const USER_CANDIDATES = ["conamsy@gmail.com", "echadmediahouse@gmail.com"];

async function findOwner(): Promise<{ id: string; email: string }> {
  for (const email of USER_CANDIDATES) {
    const u: { id: string; email: string } | null = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true }
    });
    if (u) return u;
  }
  throw new Error(
    `No AnimBook user found for any of ${USER_CANDIDATES.join(", ")}. Stopping.`
  );
}

/* --------------------------------------------------------------------- *
 * Source pages (verbatim from the-book-that-learned-to-speak.md)
 * --------------------------------------------------------------------- */

interface DemoPage {
  pageNum: number;
  narration: string;
  scene: string;
  characters: string[]; // names of cast members present on this page
}

const CAST_DESCRIPTIONS: Record<string, string> = {
  "The Book":
    "a hardback book with a faded deep-blue cloth cover, gold title lettering worn at the edges, cream pages, a red ribbon bookmark; title on the cover 'The Lighthouse Keeper'",
  "Samuel":
    "a 78-year-old man, short white beard, round wire glasses, grey knitted cardigan over a white shirt, slow careful hands",
  "Leo":
    "a 12-year-old boy, short curly black hair, green hoodie, carries a tablet in a black case",
  "The Keeper":
    "a woman in her 40s, yellow raincoat, dark hair tied back, holding a brass lantern",
  "Ms. Okafor":
    "a woman in her 50s, navy dress, short grey natural hair, reading glasses on a chain",
  "Maya":
    "a 9-year-old girl, two braids, orange sweater"
};

const VISUAL_STYLE =
  "Warm hand-painted storybook look, soft golden light, gentle camera moves. The Book's pages glow a soft gold whenever AnimBook brings it to life.";

const DEMO_PAGES: DemoPage[] = [
  {
    pageNum: 1,
    narration:
      "I am a book. Samuel wrote me forty years ago, one careful word at a time. My story is about a lighthouse keeper who never let her light go out. For a while, people read me. They laughed at the funny parts and held their breath through the storm. Then, one by one, they stopped. Now I sit on a high shelf in a quiet library, waiting.",
    scene:
      "No people. One book only: the Book stands upright between two plain grey books on the third shelf of a tall wooden bookcase. Dust drifts slowly downward through a single beam of window light coming from the left. The camera moves slowly forward toward the Book's spine. Nothing else moves.",
    characters: ["The Book"]
  },
  {
    pageNum: 2,
    narration:
      "Years passed. Dust settled on my cover like snow. People still came to the library, but their eyes stayed on glowing screens. They scrolled past stories full of moving pictures and voices. I understood. I had words, but no voice. I had pictures, but they could not move. How could I compete with a world that talks back?",
    scene:
      "Three people, one after another, walk past the bookcase from right to left: a young man, then a woman, then a teenage girl. Each holds a phone in the right hand, looks down at it, and keeps walking; screen light glows on each face. None of them looks up. The Book stays still on its shelf behind them, in focus, a thin line of dust along its top edge.",
    characters: []
  },
  {
    pageNum: 3,
    narration:
      "One rainy afternoon, slow footsteps stopped below me. It was Samuel, older now, his beard white. Beside him stood a boy holding a tablet. \"This is the one, Leo,\" Samuel said softly. \"Nobody reads it anymore.\" Leo lifted me down, blew the dust from my cover, and smiled. \"Grandpa,\" he said, \"what if people could watch it and hear it too?\"",
    scene:
      "Two people: Samuel and Leo, standing side by side in front of the bookcase. Samuel raises his right arm and points up at the Book with his right index finger. Leo reaches up with both hands, slides the Book off the shelf, brings it down, and holds it flat in front of his chest. He leans his face toward the cover and blows once; a small puff of dust lifts off and drifts to the left. Rain runs down the window behind them.",
    characters: ["Samuel", "Leo", "The Book"]
  },
  {
    pageNum: 4,
    narration:
      "Leo opened AnimBook and placed me inside. Then something wonderful happened. Something read me, not quickly and not carelessly, but the way a good friend listens. It learned every character. It found every place. It felt the cold of my storm and the warmth of my ending. For the first time in years, someone understood my whole story at once.",
    scene:
      "Two people: Leo sits at a wooden table; Samuel stands behind Leo's right shoulder. The Book lies open on the table. Leo holds the tablet upright in his left hand and taps the screen once with his right index finger. Thin threads of gold light rise from the open pages, curl upward, and flow into the tablet screen. Samuel's eyebrows lift and he leans forward slightly to watch.",
    characters: ["Samuel", "Leo", "The Book"]
  },
  {
    pageNum: 5,
    narration:
      "And then my pictures began to move. The Keeper climbed her lighthouse stairs, step by step, her lantern swinging. The sea rose and crashed against the rocks. Far out in the dark, a small ship fought the waves. I had held these moments inside me for forty years. Now anyone could see them, exactly as Samuel had dreamed them.",
    scene:
      "Inside the story world. One person: the Keeper. She climbs a spiral iron staircase inside the white lighthouse, right hand sliding up the rail, left hand holding the brass lantern at shoulder height; the lantern swings a little with each step she takes. Through the window behind her, one small wooden ship with one white sail rocks on high waves. Waves strike the black rocks below and throw white spray upward.",
    characters: ["The Keeper"]
  },
  {
    pageNum: 6,
    narration:
      "Then I heard something I had never heard before: my own voice. Warm and steady, it carried every word to the reader. \"The light must never go out,\" said the Keeper. If a reader wanted a different voice, they simply chose one. My pages could turn on their own, gently, with the story, or wait for the reader's hand.",
    scene:
      "One person: the Keeper, at the top of the lighthouse beside the great lamp. She sets the brass lantern down on the floor with her left hand. Then she grips a large brass wheel with both hands and turns it a quarter turn clockwise. As the wheel turns, the great lamp brightens, and its beam sweeps across the dark sea from left to right; the beam moves only while her hands turn the wheel and stops when they stop.",
    characters: ["The Keeper"]
  },
  {
    pageNum: 7,
    narration:
      "Soon, I was travelling. In Nairobi, a grandmother listened to me in Swahili. In São Paulo, a boy followed my storm in Portuguese. In Paris, two sisters heard the Keeper speak French. In Mumbai, Cairo and Beijing, readers met the same lighthouse in their own words. I had never left that shelf. Now I was everywhere.",
    scene:
      "A screen split into four panels, each a different home or place, each showing the same lighthouse on a tablet. Panel 1: one grandmother in an armchair by a window. Panel 2: one boy, about 10, cross-legged on a sofa. Panel 3: two sisters sitting side by side on a bed, one tablet between them. Panel 4: one man in a train seat. In every panel, the tablet is held in both hands and the person leans slightly toward the screen as the lighthouse beam on it sweeps from left to right.",
    characters: []
  },
  {
    pageNum: 8,
    narration:
      "In a classroom far away, Ms. Okafor opened me for her class. Maya usually hid at the back during reading time, because the words jumped around on the page for her. But today, each word lit up as my voice spoke it. Maya followed along, whispering the words with me. By the last page, she was reading out loud, and smiling.",
    scene:
      "Two people in focus: Ms. Okafor stands at the front beside a large screen; Maya sits at a desk in the second row with a tablet in front of her. On both screens, the words of one page glow gold one at a time, from left to right. Maya moves her right index finger along under each glowing word, and her lips move with the words. On the last word she lifts her head and smiles. The other students are soft and out of focus, seated and still.",
    characters: ["Ms. Okafor", "Maya"]
  },
  {
    pageNum: 9,
    narration:
      "Readers began leaving notes in my margins. \"This storm gave me chills.\" \"My grandfather kept a lighthouse too.\" They gathered in reading circles to talk about the Keeper. And one evening, a message arrived for Samuel: \"Thank you for this story. I read it with my daughter every night.\" Samuel read it twice. Then he took off his glasses and wiped his eyes.",
    scene:
      "One person: Samuel, sitting in an armchair at home in warm evening lamplight, holding a tablet in both hands. Small gold note cards float up from the edges of the tablet one at a time and fade. He reads, then lowers the tablet onto his lap with his left hand, takes off his glasses with his right hand, and wipes his right eye with the back of that same hand.",
    characters: ["Samuel"]
  },
  {
    pageNum: 10,
    narration:
      "I was written to be read. Now I am seen. I am heard. I am shared, in classrooms, on long journeys, at bedtime, in every language. Somewhere, on a quiet shelf, another book is still waiting for its voice. Maybe it is yours. Every story deserves to come alive. This is AnimBook.",
    scene:
      "Two people: Samuel and Leo sit side by side on a sofa with the open Book resting across both their laps. Leo turns one page with his right hand; as it lands, the page glows gold and a small beam of lighthouse light rises from it and sweeps slowly across both their faces, from left to right. The camera pulls back slowly. Final frame: the AnimBook logo, an open book with a play button in the gutter, gold on dark, fades in.",
    characters: ["Samuel", "Leo", "The Book"]
  }
];

/* --------------------------------------------------------------------- *
 * Cost pre-flight
 * --------------------------------------------------------------------- */

const HARD_CAP_USD = 6.0;
const totalNarrationChars = DEMO_PAGES.reduce((s, p) => s + p.narration.length, 0);
const estVideoUsd = DEMO_PAGES.length * MINIMAX_VIDEO_USD_768P_6S;
const estNarrationUsd = estimateMinimaxTtsCostUsd({
  characters: totalNarrationChars,
  model: appEnv.MINIMAX_TTS_MODEL
});
const estPosterUsd = DEMO_PAGES.length * 0.0035;
const estTotalUsd = estVideoUsd + estNarrationUsd + estPosterUsd;

console.log(`[produce-demo] cost pre-flight`);
console.log(`  pages       : ${DEMO_PAGES.length}`);
console.log(`  narration   : ${totalNarrationChars} chars`);
console.log(`  video (est) : $${estVideoUsd.toFixed(2)} (10 × $${MINIMAX_VIDEO_USD_768P_6S})`);
console.log(`  audio (est) : $${estNarrationUsd.toFixed(4)} (${totalNarrationChars} chars × $${MINIMAX_TTS_USD_PER_1M_CHARS_HD}/M HD)`);
console.log(`  posters     : $${estPosterUsd.toFixed(2)} (10 × $0.0035 image-01)`);
console.log(`  TOTAL (est) : $${estTotalUsd.toFixed(2)} / cap $${HARD_CAP_USD}`);
if (estTotalUsd > HARD_CAP_USD) {
  fail(`Estimated cost $${estTotalUsd.toFixed(2)} exceeds hard cap $${HARD_CAP_USD}. Stopping.`);
}

/* --------------------------------------------------------------------- *
 * Orchestration
 * --------------------------------------------------------------------- */

async function main() {
  const owner = await findOwner();
  console.log(`[produce-demo] owner = ${owner.email} (${owner.id})`);

  const slugBase = "the-book-that-learned-to-speak"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  const slug = `${slugBase}-${Date.now().toString(36)}`;

  /* -- 1. Book -- */
  const book = await prisma.book.create({
    data: {
      slug,
      creatorId: owner.id,
      title: "The Book That Learned to Speak",
      subtitle: "An AnimBook demo book for YC / Techstars",
      subcategory: "short-stories",
      author: "AnimBook",
      synopsis:
        "A 40-year-old book that nobody reads anymore meets AnimBook. Samuel and his grandson Leo show it how to be seen, heard and shared in every language.",
      vertical: "CONSUMER" as BookVertical,
      language: "en",
      status: "DRAFT",
      requiresExpertReview: false,
      expertReviewStatus: "NOT_REQUIRED",
      styleId: "painterly-mysticism",
      totalPages: DEMO_PAGES.length
    }
  });
  console.log(`[produce-demo] book = ${book.id} (slug=${book.slug})`);

  /* -- 2. StudioProject -- */
  const project = await prisma.studioProject.create({
    data: {
      ownerId: owner.id,
      bookId: book.id,
      name: "The Book That Learned to Speak",
      vertical: "CONSUMER",
      status: "BRAIN_REVIEW",
      currentStage: "BOOK_BRAIN_ANALYSIS",
      expertReviewRequired: false,
      sourceFilename: "the-book-that-learned-to-speak.md",
      manuscriptSha256: createHash("sha256")
        .update(DEMO_PAGES.map((p) => p.narration).join("\n\n"))
        .digest("hex")
    }
  });
  console.log(`[produce-demo] project = ${project.id}`);

  /* -- 3. Pages (manuscript ingest) -- */
  const sha = createHash("sha256")
    .update(DEMO_PAGES.map((p) => p.narration).join("\n\n"))
    .digest("hex");
  await prisma.page.createMany({
    data: DEMO_PAGES.map((p) => ({
      bookId: book.id,
      pageNum: p.pageNum,
      chapter: null,
      textExcerpt: p.narration,
      sourceTextSha256: sha,
      status: "PENDING" as const
    }))
  });
  console.log(`[produce-demo] ${DEMO_PAGES.length} pages ingested`);

  /* -- 4. Per-page overrides: animationPrompt + characters_present -- */
  for (const p of DEMO_PAGES) {
    const fullPrompt = `${VISUAL_STYLE} Cast: ${p.characters
      .map((n) => CAST_DESCRIPTIONS[n])
      .join("; ")}. ${p.scene}`;
    await prisma.page.update({
      where: { bookId_pageNum: { bookId: book.id, pageNum: p.pageNum } },
      data: {
        animationPrompt: fullPrompt,
        sceneType: "demo",
        emotionalRegister: "warm",
        cameraAngle: "static"
      }
    });
  }
  console.log(`[produce-demo] page animation prompts overridden`);

  /* -- 5. BookBrain (minimal — keeps buildPrompts from clobbering page overrides) -- */
  const brain = {
    title: book.title,
    author: book.author,
    genre: ["fiction", "meta-fiction"],
    cultural_origin: "global",
    target_audience: "general",
    narrative_arc: { setup_pages: [1, 2], climax_pages: [4, 5], resolution_pages: [9, 10] },
    emotional_register: [],
    characters: Object.entries(CAST_DESCRIPTIONS).map(([name, description]) => ({
      name,
      description,
      first_page: Math.min(...DEMO_PAGES.filter((p) => p.characters.includes(name)).map((p) => p.pageNum)) || 1,
      role: name === "The Book" ? "narrator" : "supporting",
      visual_keywords: []
    })),
    settings: [],
    visual_motifs: [],
    pacing_profile: [],
    style_recommendation:
      "Painterly Mysticism — soft glowing light, gentle mist, rich warm palette, dreamlike hand-painted storybook",
    /* Empty page_manifest on purpose: buildPrompts iterates this array and
       would otherwise overwrite our per-page animationPrompt above. With
       page_manifest = [], no Page.update calls are made for animationPrompt,
       and our manually-set values stand. */
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
      narratorVoiceId: "nigerian-storyteller",
      rawJson: brain as unknown as object
    },
    update: {
      genre: brain.genre,
      culturalOrigin: brain.cultural_origin,
      targetAudience: brain.target_audience,
      styleSelected: brain.style_recommendation,
      narratorVoiceId: "nigerian-storyteller",
      rawJson: brain as unknown as object
    }
  });
  console.log(`[produce-demo] bookBrain upserted, narratorVoiceId=nigerian-storyteller`);

  /* -- 6. Push to the live pipeline queue -- */
  const jobId = await enqueuePipeline({
    projectId: project.id,
    triggerStage: "VIDEO_GENERATION",
    mode: "full"
  });
  await prisma.studioProject.update({
    where: { id: project.id },
    data: { status: "GENERATING", currentStage: "VIDEO_GENERATION" }
  });
  console.log(`[produce-demo] pipeline enqueued jobId=${jobId}`);
  console.log(`[produce-demo] live link: https://animbook.com/studio/${project.id}`);

  /* -- 7. Poll for REVIEW (45 min max) -- */
  const startedAt = Date.now();
  const timeoutMs = 45 * 60 * 1000;
  let lastStatus = "";
  while (Date.now() - startedAt < timeoutMs) {
    const fresh = await prisma.studioProject.findUnique({
      where: { id: project.id },
      select: { status: true, currentStage: true }
    });
    if (fresh && fresh.status !== lastStatus) {
      console.log(`[produce-demo] poll: status=${fresh.status} stage=${fresh.currentStage}`);
      lastStatus = fresh.status ?? "";
    }
    if (fresh?.status === "REVIEW") break;
    await new Promise((r) => setTimeout(r, 30_000));
  }
  const elapsedSec = Math.round((Date.now() - startedAt) / 1000);

  /* -- 8. Per-page report -- */
  const finalPages = await prisma.page.findMany({
    where: { bookId: book.id },
    orderBy: { pageNum: "asc" },
    select: {
      id: true,
      pageNum: true,
      status: true,
      videoUrl: true,
      posterUrl: true,
      audioUrl: true,
      vttUrl: true,
      audioStatus: true,
      qualityScore: true
    }
  });

  /* -- 10. Total cost recorded -- */
  const usageRows = await prisma.usageEvent.findMany({
    where: { bookId: book.id },
    select: { provider: true, kind: true, units: true, unitCostUsd: true, totalUsd: true }
  });
  const totalUsd = usageRows.reduce((s, r) => s + r.totalUsd, 0);
  const byProvider: Record<string, { events: number; totalUsd: number }> = {};
  for (const r of usageRows) {
    if (!byProvider[r.provider]) byProvider[r.provider] = { events: 0, totalUsd: 0 };
    byProvider[r.provider].events += 1;
    byProvider[r.provider].totalUsd += r.totalUsd;
  }

  const failures = finalPages
    .filter((p) => p.status === "FLAGGED" || (p.audioStatus !== "READY" && p.audioStatus !== "NONE"))
    .map((p) => ({ pageNum: p.pageNum, pageStatus: p.status, audioStatus: p.audioStatus }));

  const report = {
    bookId: book.id,
    slug: book.slug,
    projectId: project.id,
    studioUrl: `https://animbook.com/studio/${project.id}`,
    readerUrl: `https://animbook.com/r/${book.slug}`,
    pipelineStatus: lastStatus,
    elapsedSec,
    pages: finalPages.map((p) => ({
      pageNum: p.pageNum,
      status: p.status,
      videoUrl: p.videoUrl,
      posterUrl: p.posterUrl,
      audioUrl: p.audioUrl,
      vttUrl: p.vttUrl,
      audioStatus: p.audioStatus
    })),
    costByProvider: byProvider,
    totalCostUsd: totalUsd,
    hardCapUsd: HARD_CAP_USD,
    failures,
    finalProject: await prisma.studioProject.findUnique({
      where: { id: project.id },
      select: { status: true, currentStage: true }
    })
  };

  console.log("--- produce-demo report --------------------------------------------------");
  console.log(JSON.stringify(report, null, 2));
  console.log("----------------------------------------------------------------------");
}

main()
  .catch((err) => {
    console.error("[produce-demo] unexpected:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });