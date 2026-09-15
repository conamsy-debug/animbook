import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface SeedPage {
  pageNum: number;
  text: string;
  chapter: string;
  scene: string;
  emotion: string;
  camera: string;
  animationPrompt: string;
}

interface SeedBook {
  slug: string;
  title: string;
  author: string;
  synopsis: string;
  vertical: "CONSUMER" | "TRAVEL" | "VERSE";
  language: string;
  genre: string[];
  mood: string[];
  cover: string;
  pages: SeedPage[];
}

const seedBooks: SeedBook[] = [
  {
    slug: "the-night-train",
    title: "The Night Train",
    author: "AnimBook Originals",
    synopsis:
      "A stranger boards the last train from Nairobi to Mombasa and discovers the carriage holds more than sleepers.",
    vertical: "CONSUMER",
    language: "en",
    genre: ["Human Stories", "Thrills"],
    mood: ["contemplative", "suspenseful"],
    cover: "https://placehold.co/600x900/0D1B2E/C49A1C/png?text=The+Night+Train",
    pages: [
      {
        pageNum: 1,
        chapter: "Departure",
        text: "The platform was warm with the smell of rain and diesel, and a single voice echoed above the carriages.",
        scene: "Arrival on platform",
        emotion: "anticipation",
        camera: "wide establishing shot",
        animationPrompt:
          "Wide cinematic shot of a wet station platform at dusk, lantern light refracting on steel rails, slow train motion, painterly realism."
      },
      {
        pageNum: 2,
        chapter: "Departure",
        text: "She found her berth already occupied by a man reading a newspaper that looked older than the train.",
        scene: "Cabin reveal",
        emotion: "mystery",
        camera: "close over shoulder",
        animationPrompt:
          "Intimate cabin interior, warm amber bulb light, two silhouettes facing each other through hanging curtains, slow pan."
      },
      {
        pageNum: 3,
        chapter: "Departure",
        text: "Outside, the city lights slid off the edge of the world like a deck of cards losing patience.",
        scene: "Window reflection",
        emotion: "longing",
        camera: "tracking shot along window",
        animationPrompt:
          "Handheld tracking shot following the train window as city lights streak past, reflection of passenger, deep blue palette."
      },
      {
        pageNum: 4,
        chapter: "Descent",
        text: "He folded the paper and smiled in a way that had not been used for a very long time.",
        scene: "Stranger reveal",
        emotion: "recognition",
        camera: "medium shot",
        animationPrompt:
          "Soft medium shot of an older man lowering a newspaper, warm rim light, subtle smile, painterly portraiture."
      },
      {
        pageNum: 5,
        chapter: "Descent",
        text: "There were stories he carried with him that no train timetable could carry, only the night.",
        scene: "Narrative beat",
        emotion: "gravity",
        camera: "slow zoom in",
        animationPrompt:
          "Slow cinematic push-in toward a cabin window, mist drifting past, abstract shapes suggested, painterly mysticism."
      }
    ]
  },
  {
    slug: "the-coast-of-mombasa",
    title: "The Coast of Mombasa",
    author: "AnimBook Originals",
    synopsis:
      "A travelogue of the Old Town, its alleys, its mosques, its fishermen, and the sound of the Indian Ocean on the breakwater.",
    vertical: "TRAVEL",
    language: "en",
    genre: ["The World"],
    mood: ["warm", "contemplative"],
    cover: "https://placehold.co/600x900/0D1B2E/14818E/png?text=Coast+of+Mombasa",
    pages: [
      {
        pageNum: 1,
        chapter: "Morning",
        text: "The Old Town opens its narrow alleys to the morning sun and the sound of the sea arrives two streets ahead of itself.",
        scene: "Old Town alley",
        emotion: "warmth",
        camera: "low angle tracking shot",
        animationPrompt:
          "Handheld tracking shot through narrow Old Town alley, sunlight spilling across carved wooden balconies, golden hour, painterly realism."
      },
      {
        pageNum: 2,
        chapter: "Morning",
        text: "Fishermen mend nets against the pier as dhows tilt on the shallow water like patient animals waiting for someone.",
        scene: "Pier activity",
        emotion: "rhythm",
        camera: "wide shot with foreground focus",
        animationPrompt:
          "Wide shot of dhows in turquoise water, fishermen repairing nets in foreground, soft marine haze, warm palette."
      },
      {
        pageNum: 3,
        chapter: "Midday",
        text: "A kite hovers above the fort, tethered to nothing but the wind, and the wind is in no hurry.",
        scene: "Fort exterior",
        emotion: "stillness",
        camera: "slow pan upward",
        animationPrompt:
          "Slow pan upward along weathered fort walls, a single kite tracing wide arcs against a pale blue sky, painterly."
      },
      {
        pageNum: 4,
        chapter: "Midday",
        text: "Lunch is grilled fish, coconut rice, and the patient argument between lime and salt.",
        scene: "Food closeup",
        emotion: "satisfaction",
        camera: "macro detail",
        animationPrompt:
          "Macro detail of grilled fish on banana leaf, lime being squeezed, sunlight flares, food cinematography."
      }
    ]
  },
  {
    slug: "a-poem-for-lagos",
    title: "A Poem for Lagos",
    author: "AnimBook Originals",
    synopsis:
      "Twelve lines, one city, a moving meditation on the lagoon and the long memory of its bridges.",
    vertical: "VERSE",
    language: "en",
    genre: ["Otherworlds", "Human Stories"],
    mood: ["introspective", "longing"],
    cover: "https://placehold.co/600x900/0D1B2E/9D4C73/png?text=A+Poem+for+Lagos",
    pages: [
      {
        pageNum: 1,
        chapter: "I",
        text: "Lagos is a long sentence that the lagoon keeps interrupting with soft commas.",
        scene: "Lagoon dawn",
        emotion: "introspective",
        camera: "wide aerial slow descent",
        animationPrompt:
          "Slow aerial descent over Lagos lagoon at dawn, watercolour palette, pastel mists, abstract impressionism."
      },
      {
        pageNum: 2,
        chapter: "I",
        text: "Each bridge is a question. Each ferry, an answer spoken in the same dialect.",
        scene: "Bridge silhouette",
        emotion: "wonder",
        camera: "wide static",
        animationPrompt:
          "Wide shot of a Lagos bridge silhouetted against a copper sun, ferries passing underneath, painterly mysticism."
      },
      {
        pageNum: 3,
        chapter: "II",
        text: "The market women begin before the city remembers its own name.",
        scene: "Market pre-dawn",
        emotion: "vitality",
        camera: "close handheld",
        animationPrompt:
          "Close handheld shot of market women arranging peppers and tomatoes in baskets, candle light, warm shadows, painterly realism."
      },
      {
        pageNum: 4,
        chapter: "II",
        text: "A child runs after a kite shaped like the future, and loses it gently into the wind.",
        scene: "Kite in flight",
        emotion: "joy",
        camera: "low angle tracking",
        animationPrompt:
          "Low angle tracking shot of a child running after a kite, kite snapping against the sky, slow motion, watercolour."
      }
    ]
  }
];

async function main() {
  console.log("[seed] starting");

  await prisma.user.upsert({
    where: { email: "demo@animbook.com" },
    update: {},
    create: {
      clerkId: "demo:demo@animbook.com",
      email: "demo@animbook.com",
      name: "AnimBook Reader",
      tier: "PREMIUM",
      subscriptionStatus: "ACTIVE"
    }
  });

  for (const seed of seedBooks) {
    const book = await prisma.book.upsert({
      where: { slug: seed.slug },
      update: {
        title: seed.title,
        author: seed.author,
        synopsis: seed.synopsis,
        vertical: seed.vertical,
        language: seed.language,
        genreTags: seed.genre,
        moodTags: seed.mood,
        coverUrl: seed.cover,
        status: "PUBLISHED",
        totalPages: seed.pages.length
      },
      create: {
        slug: seed.slug,
        title: seed.title,
        author: seed.author,
        synopsis: seed.synopsis,
        vertical: seed.vertical,
        language: seed.language,
        genreTags: seed.genre,
        moodTags: seed.mood,
        coverUrl: seed.cover,
        status: "PUBLISHED",
        totalPages: seed.pages.length
      }
    });

    await prisma.page.deleteMany({ where: { bookId: book.id } });
    await prisma.page.createMany({
      data: seed.pages.map((p) => ({
        bookId: book.id,
        pageNum: p.pageNum,
        chapter: p.chapter,
        textExcerpt: p.text,
        sourceTextSha256: `${seed.slug}-${p.pageNum}`,
        animationPrompt: p.animationPrompt,
        negativePrompt: "blurry, distorted faces, watermarks",
        sceneType: p.scene,
        emotionalRegister: p.emotion,
        cameraAngle: p.camera,
        status: "APPROVED" as const,
        videoUrl: `https://placehold.co/640x360/080C14/${seed.vertical === "TRAVEL" ? "14818E" : seed.vertical === "VERSE" ? "9D4C73" : "C49A1C"}/png?text=Page+${p.pageNum}`,
        posterUrl: `https://placehold.co/640x360/080C14/${seed.vertical === "TRAVEL" ? "14818E" : seed.vertical === "VERSE" ? "9D4C73" : "C49A1C"}/png?text=Page+${p.pageNum}`,
        qualityScore: 0.85
      }))
    });

    await prisma.bookBrain.upsert({
      where: { bookId: book.id },
      update: {},
      create: {
        bookId: book.id,
        genre: seed.genre,
        culturalOrigin: "East Africa",
        targetAudience: "adult",
        styleSelected: "Painterly Mysticism",
        rawJson: {
          title: seed.title,
          author: seed.author,
          genre: seed.genre,
          cultural_origin: "East Africa",
          target_audience: "adult",
          style_recommendation: "Painterly Mysticism",
          characters: [],
          settings: [],
          page_manifest: seed.pages.map((p) => ({
            page_num: p.pageNum,
            text_excerpt: p.text,
            setting: p.chapter,
            characters_present: [],
            primary_action: p.scene,
            emotion: p.emotion,
            camera_angle: p.camera,
            animation_prompt_draft: p.animationPrompt
          }))
        }
      }
    });

    console.log(`[seed] ${seed.slug} -> ${seed.pages.length} pages`);
  }

  console.log("[seed] done");
}

main()
  .catch((err) => {
    console.error("[seed] failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });