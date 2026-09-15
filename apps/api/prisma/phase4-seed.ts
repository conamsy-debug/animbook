/**
 * Phase 4 seed: AnimBook WORLDS live data — the Lagos Nights universe.
 *
 * Three short AnimBooks that share the same character roster and visual
 * style, attached to a single World so the cross-book page can prove the
 * feature end-to-end.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface LagosPage {
  pageNum: number;
  chapter: string;
  text: string;
  scene: string;
  emotion: string;
  camera: string;
  animationPrompt: string;
}

const sharedCharacters = ["Adaeze", "Ifeoma", "Tunde", "Lagos lagoon"];

const nightTrainPages: LagosPage[] = [
  {
    pageNum: 1, chapter: "Night 1",
    text: "Adaeze and Ifeoma took the last train from Yaba to Marina, the windows wide open to the lagoon smell.",
    scene: "Yaba platform", emotion: "anticipation", camera: "wide",
    animationPrompt: "Wide cinematic of the last train pulling into Yaba at night, lagoon mist, painterly mysticism."
  },
  {
    pageNum: 2, chapter: "Night 1",
    text: "Tunde was already on the carriage, reading a paperback he never opened, watching the dark.",
    scene: "Inside the carriage", emotion: "contemplative", camera: "medium",
    animationPrompt: "Medium shot of a quiet carriage, lamplight, painterly realism."
  },
  {
    pageNum: 3, chapter: "Night 1",
    text: "The third bridge over the lagoon had a new sound that night — a low hum the city was making for itself.",
    scene: "Third Mainland Bridge", emotion: "wonder", camera: "wide aerial",
    animationPrompt: "Wide aerial of the Third Mainland Bridge, a soft hum of city lights, painterly."
  }
];

const lagoonPages: LagosPage[] = [
  {
    pageNum: 1, chapter: "Night 2",
    text: "By morning the lagoon had forgotten the train. The water returned what the city gave it and asked for nothing back.",
    scene: "Lagoon at dawn", emotion: "calm", camera: "wide",
    animationPrompt: "Wide shot of the Lagos lagoon at dawn, soft mist, painterly."
  },
  {
    pageNum: 2, chapter: "Night 2",
    text: "Adaeze walked along the Marina waterfront, counting fishing boats, finding six fewer than the week before.",
    scene: "Marina waterfront", emotion: "wistful", camera: "tracking",
    animationPrompt: "Tracking shot along the Marina waterfront, painterly."
  }
];

const letterPages: LagosPage[] = [
  {
    pageNum: 1, chapter: "Night 3",
    text: "Tunde's letter arrived three weeks late, addressed to a Lagos that no longer quite existed.",
    scene: "Mailroom", emotion: "reflective", camera: "close-up",
    animationPrompt: "Close-up of a letter on a desk, morning light, painterly."
  },
  {
    pageNum: 2, chapter: "Night 3",
    text: "Ifeoma read it twice. The third time, she walked to the lagoon, and the lagoon read it with her.",
    scene: "Lagoon at dusk", emotion: "grounded", camera: "wide",
    animationPrompt: "Wide dusk shot of two figures by the lagoon, painterly."
  },
  {
    pageNum: 3, chapter: "Night 3",
    text: "The city hummed again, softer this time, as if it had learned a new song to sing itself to sleep.",
    scene: "Skyline at night", emotion: "warm", camera: "wide aerial",
    animationPrompt: "Wide aerial of the Lagos skyline at night, painterly mysticism."
  }
];

async function ensureBook(slug: string, title: string, author: string, synopsis: string, vertical: "CONSUMER" | "TRAVEL" | "VERSE", pages: LagosPage[]) {
  const book = await prisma.book.upsert({
    where: { slug },
    update: { title, author, synopsis, vertical, status: "PUBLISHED", totalPages: pages.length, language: "en", genreTags: ["Human Stories", "Lagos Nights"], coverUrl: `https://placehold.co/600x900/0D1B2E/${vertical === "TRAVEL" ? "14818E" : "C49A1C"}/png?text=${encodeURIComponent(title)}` },
    create: { slug, title, author, synopsis, vertical, status: "PUBLISHED", totalPages: pages.length, language: "en", genreTags: ["Human Stories", "Lagos Nights"], coverUrl: `https://placehold.co/600x900/0D1B2E/${vertical === "TRAVEL" ? "14818E" : "C49A1C"}/png?text=${encodeURIComponent(title)}` }
  });
  await prisma.page.deleteMany({ where: { bookId: book.id } });
  await prisma.page.createMany({
    data: pages.map((p) => ({
      bookId: book.id,
      pageNum: p.pageNum,
      chapter: p.chapter,
      textExcerpt: p.text,
      sourceTextSha256: `lagos-${slug}-${p.pageNum}`,
      animationPrompt: p.animationPrompt,
      negativePrompt: "blurry, distorted faces, watermarks",
      sceneType: p.scene,
      emotionalRegister: p.emotion,
      cameraAngle: p.camera,
      status: "APPROVED" as const,
      videoUrl: `https://placehold.co/640x360/080C14/C49A1C/png?text=${encodeURIComponent(title)}+${p.pageNum}`,
      posterUrl: `https://placehold.co/640x360/080C14/C49A1C/png?text=${encodeURIComponent(title)}+${p.pageNum}`,
      qualityScore: 0.88
    }))
  });
  return book;
}

async function main() {
  console.log("[phase4-seed] starting");

  const nightTrain = await ensureBook("lagos-nights-1-the-last-train", "Lagos Nights · The Last Train", "AnimBook Originals", "The first of the Lagos Nights trilogy. Three friends meet on the last train across the lagoon.", "CONSUMER", nightTrainPages);
  const lagoon = await ensureBook("lagos-nights-2-the-lagoon", "Lagos Nights · The Lagoon", "AnimBook Originals", "The second of the Lagos Nights trilogy. Adaeze counts the boats, Ifeoma counts the days.", "TRAVEL", lagoonPages);
  const letter = await ensureBook("lagos-nights-3-the-letter", "Lagos Nights · The Letter", "AnimBook Originals", "The third of the Lagos Nights trilogy. A letter arrives three weeks late.", "VERSE", letterPages);

  const world = await prisma.world.upsert({
    where: { slug: "lagos-nights" },
    update: { name: "Lagos Nights", synopsis: "A trilogy that follows Adaeze, Ifeoma, and Tunde across the Lagos lagoon. The city is a fourth character.", accentColor: "#C49A1C", styleId: "painterly-mysticism" },
    create: { slug: "lagos-nights", name: "Lagos Nights", synopsis: "A trilogy that follows Adaeze, Ifeoma, and Tunde across the Lagos lagoon. The city is a fourth character.", accentColor: "#C49A1C", styleId: "painterly-mysticism" }
  });
  for (const [ordinal, book] of [[0, nightTrain], [1, lagoon], [2, letter]] as const) {
    await prisma.worldMember.upsert({
      where: { bookId: book.id },
      create: { worldId: world.id, bookId: book.id, ordinal, sharedCharacters },
      update: { ordinal, sharedCharacters }
    });
  }

  console.log(`[phase4-seed] ${world.slug} -> 3 books, ${sharedCharacters.length} shared characters`);
  console.log("[phase4-seed] done");
}

main()
  .catch((err) => {
    console.error("[phase4-seed] failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });