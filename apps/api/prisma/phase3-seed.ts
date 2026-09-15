/**
 * Phase 3 WELLNESS vertical seed.
 *
 * Seed a sleep story AnimBook with deliberate slow pacing. Future
 * AnimBook DREAM will tune the runtime to this profile.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("[phase3-seed] starting");

  const wellness = await prisma.book.upsert({
    where: { slug: "the-sleeping-coast" },
    update: {
      title: "The Sleeping Coast",
      author: "AnimBook Originals",
      synopsis:
        "A WELLNESS AnimBook designed for sleep. The pacing is slow, the palette is muted, the narration drops to 0.7× by the third page.",
      vertical: "WELLNESS",
      language: "en",
      genreTags: ["Sleep story", "Mindfulness"],
      moodTags: ["calm", "soft"],
      ageRating: "All ages",
      coverUrl: "https://placehold.co/600x900/0D1B2E/3F8172/png?text=The+Sleeping+Coast",
      status: "PUBLISHED",
      totalPages: 5,
      narrationLanguages: ["en", "sw", "fr"]
    },
    create: {
      slug: "the-sleeping-coast",
      title: "The Sleeping Coast",
      author: "AnimBook Originals",
      synopsis:
        "A WELLNESS AnimBook designed for sleep. The pacing is slow, the palette is muted, the narration drops to 0.7× by the third page.",
      vertical: "WELLNESS",
      language: "en",
      genreTags: ["Sleep story", "Mindfulness"],
      moodTags: ["calm", "soft"],
      ageRating: "All ages",
      coverUrl: "https://placehold.co/600x900/0D1B2E/3F8172/png?text=The+Sleeping+Coast",
      status: "PUBLISHED",
      totalPages: 5,
      narrationLanguages: ["en", "sw", "fr"]
    }
  });

  await prisma.page.deleteMany({ where: { bookId: wellness.id } });
  await prisma.page.createMany({
    data: [
      {
        bookId: wellness.id, pageNum: 1, chapter: "Opening",
        textExcerpt: "Set the room down. Let the lamp dim. The coast is going to sleep, and so are you.",
        sourceTextSha256: "p3-well-1",
        animationPrompt: "Wide cinematic of a coastline at deep dusk, last light fading on calm water.",
        sceneType: "establishing", emotionalRegister: "calm", cameraAngle: "wide aerial",
        status: "APPROVED" as const,
        videoUrl: "https://placehold.co/640x360/080C14/3F8172/png?text=Coast+Dusk",
        posterUrl: "https://placehold.co/640x360/080C14/3F8172/png?text=Coast+Dusk",
        qualityScore: 0.9
      },
      {
        bookId: wellness.id, pageNum: 2, chapter: "First breath",
        textExcerpt: "Breathe in for four. Hold for four. Release for four. The tide follows the same rhythm, every time.",
        sourceTextSha256: "p3-well-2",
        animationPrompt: "Slow motion water meeting sand, painterly.",
        sceneType: "instructional", emotionalRegister: "soft", cameraAngle: "macro",
        status: "APPROVED" as const,
        videoUrl: "https://placehold.co/640x360/080C14/3F8172/png?text=Breath",
        posterUrl: "https://placehold.co/640x360/080C14/3F8172/png?text=Breath",
        qualityScore: 0.9
      },
      {
        bookId: wellness.id, pageNum: 3, chapter: "Drift",
        textExcerpt: "Somewhere below the surface, the water is moving the way you breathe now: slow, slow, slow.",
        sourceTextSha256: "p3-well-3",
        animationPrompt: "Underwater drift, soft blue-green, painterly realism.",
        sceneType: "narrative beat", emotionalRegister: "sleepy", cameraAngle: "underwater",
        status: "APPROVED" as const,
        videoUrl: "https://placehold.co/640x360/080C14/3F8172/png?text=Drift",
        posterUrl: "https://placehold.co/640x360/080C14/3F8172/png?text=Drift",
        qualityScore: 0.9
      },
      {
        bookId: wellness.id, pageNum: 4, chapter: "Yield",
        textExcerpt: "The mind does not need to follow you into sleep. Let it keep walking the shore if it wants to.",
        sourceTextSha256: "p3-well-4",
        animationPrompt: "Wide shot of a single figure on an empty beach, painterly.",
        sceneType: "narrative beat", emotionalRegister: "grounded", cameraAngle: "wide",
        status: "APPROVED" as const,
        videoUrl: "https://placehold.co/640x360/080C14/3F8172/png?text=Yield",
        posterUrl: "https://placehold.co/640x360/080C14/3F8172/png?text=Yield",
        qualityScore: 0.9
      },
      {
        bookId: wellness.id, pageNum: 5, chapter: "Rest",
        textExcerpt: "The room is dark. The page is here. You can leave it open or close it. Either way, the night is held.",
        sourceTextSha256: "p3-well-5",
        animationPrompt: "Slow fade to a single lit window seen from a distance, painterly realism.",
        sceneType: "narrative beat", emotionalRegister: "soft", cameraAngle: "wide",
        status: "APPROVED" as const,
        videoUrl: "https://placehold.co/640x360/080C14/3F8172/png?text=Rest",
        posterUrl: "https://placehold.co/640x360/080C14/3F8172/png?text=Rest",
        qualityScore: 0.9
      }
    ]
  });

  console.log(`[phase3-seed] the-sleeping-coast -> 5 pages (WELLNESS)`);
  console.log("[phase3-seed] done");
}

main()
  .catch((err) => {
    console.error("[phase3-seed] failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });