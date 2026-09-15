/**
 * Phase 2 finish seed.
 *
 * - Creates two publishers (one consumer, one faith).
 * - Promotes the demo user with `theological_advisor` + `publisher_admin` roles
 *   so the review + dashboard surfaces work end-to-end out of the box.
 * - Seeds a BUSINESS AnimBook ("The First 90 Days at Your New Job")
 *   with key insight extraction so SCORM has live data.
 * - Seeds a FAITH AnimBook ("The Lord's Prayer — Illuminated") with
 *   iconographic notes so the FAITH review workflow has real content.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("[phase2-seed] starting");

  // 1. Promote the demo user with platform + faith + publisher roles.
  const demo = await prisma.user.upsert({
    where: { email: "demo@animbook.com" },
    update: { roles: ["platform_admin", "theological_advisor", "publisher_admin"] },
    create: {
      clerkId: "demo:demo@animbook.com",
      email: "demo@animbook.com",
      name: "AnimBook Reader",
      tier: "PREMIUM",
      subscriptionStatus: "ACTIVE",
      roles: ["platform_admin", "theological_advisor", "publisher_admin"]
    }
  });

  // 2. Publishers.
  const meridian = await prisma.publisher.upsert({
    where: { id: "pub-meridian" },
    update: {},
    create: {
      id: "pub-meridian",
      name: "Meridian Press",
      contactEmail: "rights@meridian.press",
      licenseAgreementUrl: "https://meridian.press/licence",
      revenueSharePct: 70
    }
  });
  await prisma.publisher.upsert({
    where: { id: "pub-faithhouse" },
    update: {},
    create: {
      id: "pub-faithhouse",
      name: "Faith House Editions",
      contactEmail: "editions@faith.house",
      licenseAgreementUrl: "https://faith.house/licence",
      revenueSharePct: 65
    }
  });

  // 3. BUSINESS AnimBook.
  const business = await prisma.book.upsert({
    where: { slug: "the-first-90-days" },
    update: {
      title: "The First 90 Days at Your New Job",
      author: "Maya Okeke",
      synopsis:
        "A BUSINESS AnimBook for new managers. Every page pairs a key insight with a 10-second animation. The book ships with SCORM 2004 4th Edition packaging for L&D teams.",
      vertical: "BUSINESS",
      language: "en",
      genreTags: ["L&D", "Management"],
      moodTags: ["focused", "practical"],
      ageRating: "Corporate",
      coverUrl: "https://placehold.co/600x900/0D1B2E/B58B27/png?text=First+90+Days",
      status: "PUBLISHED",
      totalPages: 6,
      narrationLanguages: ["en", "fr", "es", "pt"],
      publisherId: meridian.id
    },
    create: {
      slug: "the-first-90-days",
      title: "The First 90 Days at Your New Job",
      author: "Maya Okeke",
      synopsis:
        "A BUSINESS AnimBook for new managers. Every page pairs a key insight with a 10-second animation. The book ships with SCORM 2004 4th Edition packaging for L&D teams.",
      vertical: "BUSINESS",
      language: "en",
      genreTags: ["L&D", "Management"],
      moodTags: ["focused", "practical"],
      ageRating: "Corporate",
      coverUrl: "https://placehold.co/600x900/0D1B2E/B58B27/png?text=First+90+Days",
      status: "PUBLISHED",
      totalPages: 6,
      narrationLanguages: ["en", "fr", "es", "pt"],
      publisherId: meridian.id
    }
  });

  await prisma.page.deleteMany({ where: { bookId: business.id } });
  await prisma.page.createMany({
    data: [
      {
        bookId: business.id, pageNum: 1, chapter: "Week 1",
        textExcerpt: "The first week is not about impressing people. It's about learning how the work actually moves.",
        sourceTextSha256: "p2-biz-1",
        animationPrompt: "Slow aerial descent onto a glass office tower at dawn, soft corporate ambient.",
        sceneType: "establishing", emotionalRegister: "calm", cameraAngle: "wide aerial",
        status: "APPROVED" as const,
        videoUrl: "https://placehold.co/640x360/080C14/B58B27/png?text=Week+1",
        posterUrl: "https://placehold.co/640x360/080C14/B58B27/png?text=Week+1",
        qualityScore: 0.88
      },
      {
        bookId: business.id, pageNum: 2, chapter: "Week 1",
        textExcerpt: "Ask everyone you meet the same three questions: what works here, what's broken, and what do you wish someone had told you on day one?",
        sourceTextSha256: "p2-biz-2",
        animationPrompt: "Three questions appearing in sequence on a clean whiteboard, painterly.",
        sceneType: "instructional", emotionalRegister: "focused", cameraAngle: "static medium",
        status: "APPROVED" as const,
        videoUrl: "https://placehold.co/640x360/080C14/B58B27/png?text=Questions",
        posterUrl: "https://placehold.co/640x360/080C14/B58B27/png?text=Questions",
        qualityScore: 0.88
      },
      {
        bookId: business.id, pageNum: 3, chapter: "Week 4",
        textExcerpt: "By week four, identify the political map: who actually decides, who influences decisions, and who carries the institutional memory.",
        sourceTextSha256: "p2-biz-3",
        animationPrompt: "Org chart morphing into a network of nodes, painterly realism.",
        sceneType: "diagram", emotionalRegister: "analytical", cameraAngle: "overhead",
        status: "APPROVED" as const,
        videoUrl: "https://placehold.co/640x360/080C14/B58B27/png?text=Political+Map",
        posterUrl: "https://placehold.co/640x360/080C14/B58B27/png?text=Political+Map",
        qualityScore: 0.88
      },
      {
        bookId: business.id, pageNum: 4, chapter: "Week 8",
        textExcerpt: "Run a small win in your second month. Ship something tiny that proves you understand the org. Visibility follows delivery, not the other way around.",
        sourceTextSha256: "p2-biz-4",
        animationPrompt: "Slow tracking shot along a launch checklist ticking off, painterly.",
        sceneType: "narrative beat", emotionalRegister: "confident", cameraAngle: "tracking",
        status: "APPROVED" as const,
        videoUrl: "https://placehold.co/640x360/080C14/B58B27/png?text=Small+Win",
        posterUrl: "https://placehold.co/640x360/080C14/B58B27/png?text=Small+Win",
        qualityScore: 0.88
      },
      {
        bookId: business.id, pageNum: 5, chapter: "Week 12",
        textExcerpt: "The first 90 days end when you stop asking for permission to act and start being held accountable for outcomes.",
        sourceTextSha256: "p2-biz-5",
        animationPrompt: "Wide establishing of a calendar page flipping past 90 days, painterly mysticism.",
        sceneType: "reflection", emotionalRegister: "grounded", cameraAngle: "macro close-up",
        status: "APPROVED" as const,
        videoUrl: "https://placehold.co/640x360/080C14/B58B27/png?text=Day+90",
        posterUrl: "https://placehold.co/640x360/080C14/B58B27/png?text=Day+90",
        qualityScore: 0.88
      },
      {
        bookId: business.id, pageNum: 6, chapter: "Cohort Note",
        textExcerpt: "Share what you learned. The cohort reading this book next quarter needs your honest notes more than they need another framework.",
        sourceTextSha256: "p2-biz-6",
        animationPrompt: "Wide shot of an open notebook on a desk, morning light, painterly.",
        sceneType: "narrative beat", emotionalRegister: "warm", cameraAngle: "wide",
        status: "APPROVED" as const,
        videoUrl: "https://placehold.co/640x360/080C14/B58B27/png?text=Cohort+Note",
        posterUrl: "https://placehold.co/640x360/080C14/B58B27/png?text=Cohort+Note",
        qualityScore: 0.88
      }
    ]
  });

  // 4. FAITH AnimBook (still PENDING review so the workflow has live data).
  const faith = await prisma.book.upsert({
    where: { slug: "the-lords-prayer-illuminated" },
    update: {
      title: "The Lord's Prayer · Illuminated",
      author: "AnimBook Originals",
      synopsis:
        "The Lord's Prayer, line by line, animated in sacred-realism style. Cross-tradition iconography, gentle pacing. FAITH review workflow applies.",
      vertical: "FAITH",
      language: "en",
      genreTags: ["Scripture", "Christianity"],
      moodTags: ["contemplative", "sacred"],
      ageRating: "All ages",
      coverUrl: "https://placehold.co/600x900/0D1B2E/6B2D8B/png?text=Lords+Prayer",
      status: "DRAFT",
      requiresExpertReview: true,
      expertReviewStatus: "PENDING",
      iconographicNotes: "Avoid anthropomorphic depictions of the divine. Light rays are acceptable. Hands raised in prayer are OK across Christian, Jewish and Islamic iconography.",
      narrationLanguages: ["en", "fr", "es", "ar", "sw"]
    },
    create: {
      slug: "the-lords-prayer-illuminated",
      title: "The Lord's Prayer · Illuminated",
      author: "AnimBook Originals",
      synopsis:
        "The Lord's Prayer, line by line, animated in sacred-realism style. Cross-tradition iconography, gentle pacing. FAITH review workflow applies.",
      vertical: "FAITH",
      language: "en",
      genreTags: ["Scripture", "Christianity"],
      moodTags: ["contemplative", "sacred"],
      ageRating: "All ages",
      coverUrl: "https://placehold.co/600x900/0D1B2E/6B2D8B/png?text=Lords+Prayer",
      status: "DRAFT",
      requiresExpertReview: true,
      expertReviewStatus: "PENDING",
      iconographicNotes: "Avoid anthropomorphic depictions of the divine. Light rays are acceptable. Hands raised in prayer are OK across Christian, Jewish and Islamic iconography.",
      narrationLanguages: ["en", "fr", "es", "ar", "sw"]
    }
  });

  await prisma.page.deleteMany({ where: { bookId: faith.id } });
  await prisma.page.createMany({
    data: [
      {
        bookId: faith.id, pageNum: 1, chapter: "Our Father",
        textExcerpt: "Our Father, who art in heaven, hallowed be thy name.",
        sourceTextSha256: "p2-faith-1",
        animationPrompt: "Wide cinematic establishing of a sunrise over the Sea of Galilee, painterly mysticism.",
        sceneType: "establishing", emotionalRegister: "contemplative", cameraAngle: "wide aerial",
        status: "PENDING" as const,
        videoUrl: "https://placehold.co/640x360/080C14/6B2D8B/png?text=Our+Father",
        posterUrl: "https://placehold.co/640x360/080C14/6B2D8B/png?text=Our+Father",
        qualityScore: 0.85
      },
      {
        bookId: faith.id, pageNum: 2, chapter: "Thy Kingdom",
        textExcerpt: "Thy kingdom come, thy will be done, on earth as it is in heaven.",
        sourceTextSha256: "p2-faith-2",
        animationPrompt: "Slow pan across an ancient olive grove, soft morning mist, painterly.",
        sceneType: "narrative beat", emotionalRegister: "sacred", cameraAngle: "slow pan",
        status: "PENDING" as const,
        videoUrl: "https://placehold.co/640x360/080C14/6B2D8B/png?text=Thy+Kingdom",
        posterUrl: "https://placehold.co/640x360/080C14/6B2D8B/png?text=Thy+Kingdom",
        qualityScore: 0.85
      },
      {
        bookId: faith.id, pageNum: 3, chapter: "Daily Bread",
        textExcerpt: "Give us this day our daily bread.",
        sourceTextSha256: "p2-faith-3",
        animationPrompt: "Macro detail of wheat and bread on a wooden table, morning light, painterly.",
        sceneType: "narrative beat", emotionalRegister: "warm", cameraAngle: "macro",
        status: "PENDING" as const,
        videoUrl: "https://placehold.co/640x360/080C14/6B2D8B/png?text=Daily+Bread",
        posterUrl: "https://placehold.co/640x360/080C14/6B2D8B/png?text=Daily+Bread",
        qualityScore: 0.85
      }
    ]
  });

  // Attach the FAITH book to a StudioProject owned by the demo user so the
  // review workflow has a real creator-side surface to attach to.
  await prisma.studioProject.upsert({
    where: { bookId: faith.id },
    update: { ownerId: demo.id },
    create: {
      ownerId: demo.id,
      bookId: faith.id,
      name: "The Lord's Prayer · Studio",
      vertical: "FAITH",
      status: "BRAIN_REVIEW",
      currentStage: "BOOK_BRAIN_ANALYSIS",
      expertReviewRequired: true
    }
  });

  // 5. A sample royalty entry so the Creator portal has live data.
  await prisma.royaltyEntry.upsert({
    where: { id: "royalty-first-90-q1" },
    update: {},
    create: {
      id: "royalty-first-90-q1",
      bookId: business.id,
      payeeId: demo.id,
      amountCents: 41200,
      currency: "USD",
      periodStart: new Date("2026-04-01T00:00:00.000Z"),
      periodEnd: new Date("2026-06-30T23:59:59.000Z"),
      notes: "Q2 payout — Meridian Press consortium"
    }
  });

  console.log(`[phase2-seed] ${business.slug} -> 6 pages (BUSINESS, SCORM ready)`);
  console.log(`[phase2-seed] ${faith.slug} -> 3 pages (FAITH, review pending)`);
  console.log(`[phase2-seed] 2 publishers seeded, demo user promoted`);
  console.log("[phase2-seed] done");
}

main()
  .catch((err) => {
    console.error("[phase2-seed] failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });