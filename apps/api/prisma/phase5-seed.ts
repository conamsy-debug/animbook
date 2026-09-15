/**
 * Phase 5 seed: AnimBook ARCHIVE + AnimBook SCHOOL.
 *
 *   - Archive project "Voices of the Lagoon" — a Lagos oral history
 *     collection with one consent record and two cultural notes (HIGH tier).
 *   - Classroom "Year 9 · Studio" with the demo user as teacher and 3
 *     students (the demo user + 2 seeded student accounts), a curated
 *     library, and one open assignment.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function ensureStudent(email: string, name: string) {
  return prisma.user.upsert({
    where: { email },
    update: { roles: ["student"], name },
    create: {
      clerkId: `student:${email}`,
      email,
      name,
      tier: "BASIC",
      roles: ["student"]
    }
  });
}

async function main() {
  console.log("[phase5-seed] starting");

  const demo = await prisma.user.upsert({
    where: { email: "demo@animbook.com" },
    update: { roles: ["platform_admin", "theological_advisor", "publisher_admin", "archive_steward", "teacher"] },
    create: {
      clerkId: "demo:demo@animbook.com",
      email: "demo@animbook.com",
      name: "AnimBook Reader",
      tier: "PREMIUM",
      subscriptionStatus: "ACTIVE",
      roles: ["platform_admin", "theological_advisor", "publisher_admin", "archive_steward", "teacher"]
    }
  });

  // --- ARCHIVE ---
  const archive = await prisma.archiveProject.upsert({
    where: { slug: "voices-of-the-lagoon" },
    update: {},
    create: {
      slug: "voices-of-the-lagoon",
      title: "Voices of the Lagoon",
      steward: "AnimBook Archive · Lagos",
      region: "West Africa · Lagos",
      communityContext: "Oral histories collected from fishing families on the Lagos lagoon, 2024-2026. Recorded with consent and reviewed by community elders.",
      sensitivityTier: "HIGH",
      partnerOrg: "Lagos Heritage Trust",
      partnerUrl: "https://lagosheritage.example.org/voices",
      status: "DRAFT"
    }
  });

  await prisma.archiveConsent.upsert({
    where: { id: "consent-ade-001" },
    update: {},
    create: {
      id: "consent-ade-001",
      projectId: archive.id,
      subjectName: "Adaeze Okafor",
      relationship: "Subject — fisher · third-generation",
      consentText: "I consent to my oral history being animated and published as part of the Voices of the Lagoon collection. I retain the right to withdraw at any time.",
      consentMediaUrl: "https://example.org/consent/ade-001",
      scope: "PUBLICATION"
    }
  });

  await prisma.archiveCulturalNote.upsert({
    where: { id: "culture-voice-lagoon" },
    update: {},
    create: {
      id: "culture-voice-lagoon",
      projectId: archive.id,
      category: "VOICE",
      note: "Narrate in the cadence of lagoon fishing families — slow, reflective, no Western dramatic beats. Pacing is set by the breathing rhythm of the recording.",
      voiceGuidance: "Pace 0.85×, low motion, soft palette. Match breath length.",
      reviewerName: "Chief Adeyemi · Lagos Heritage Trust"
    }
  });

  await prisma.archiveCulturalNote.upsert({
    where: { id: "culture-iconography-lagoon" },
    update: {},
    create: {
      id: "culture-iconography-lagoon",
      projectId: archive.id,
      category: "ICONOGRAPHY",
      note: "Do not depict the lagoon as empty. Always include at least one watercraft silhouette in any establishing frame. Avoid aerial drone shots — the community finds them invasive.",
      iconographicConcerns: ["drone shots", "empty water", "manipulated drone footage"],
      reviewerName: "Lagos Heritage Trust · visual review"
    }
  });

  // --- SCHOOL ---
  const teacher = demo;
  const studentA = await ensureStudent("ada.animbook.student@example.org", "Ada AnimBook");
  const studentB = await ensureStudent("ife.animbook.student@example.org", "Ife AnimBook");
  const studentC = await ensureStudent("tunde.animbook.student@example.org", "Tunde AnimBook");

  const classroom = await prisma.classroom.upsert({
    where: { slug: "year-9-studio" },
    update: {
      libraryBookIds: [
        (await prisma.book.findUnique({ where: { slug: "a-poem-for-lagos" } }))?.id ?? "",
        (await prisma.book.findUnique({ where: { slug: "lagos-nights-1-the-last-train" } }))?.id ?? "",
        (await prisma.book.findUnique({ where: { slug: "the-tale-of-peter-rabbit" } }))?.id ?? ""
      ].filter(Boolean)
    },
    create: {
      name: "Year 9 · Studio",
      slug: "year-9-studio",
      teacherId: teacher.id,
      schoolName: "AnimBook Academy",
      gradeBand: "9",
      libraryBookIds: [
        (await prisma.book.findUnique({ where: { slug: "a-poem-for-lagos" } }))?.id ?? "",
        (await prisma.book.findUnique({ where: { slug: "lagos-nights-1-the-last-train" } }))?.id ?? "",
        (await prisma.book.findUnique({ where: { slug: "the-tale-of-peter-rabbit" } }))?.id ?? ""
      ].filter(Boolean)
    }
  });

  for (const student of [studentA, studentB, studentC]) {
    await prisma.classroomMembership.upsert({
      where: { classroomId_studentId: { classroomId: classroom.id, studentId: student.id } },
      create: { classroomId: classroom.id, studentId: student.id, role: "STUDENT" },
      update: { role: "STUDENT" }
    });
  }

  await prisma.classroomAssignment.upsert({
    where: { id: "year-9-assignment-1" },
    update: {},
    create: {
      id: "year-9-assignment-1",
      classroomId: classroom.id,
      title: "Animate a Lagos memory",
      brief: "Pick a memory you carry of Lagos — three pages, one scene each. Use any style. Submit when the manuscript is ready.",
      rubric: { pacing: 0.2, voice: 0.2, visual_consistency: 0.3, completion: 0.3 },
      status: "OPEN"
    }
  });

  console.log(`[phase5-seed] voices-of-the-lagoon (${archive.sensitivityTier}) + 1 consent + 2 cultural notes`);
  console.log(`[phase5-seed] year-9-studio classroom with 3 students, 1 assignment`);
  console.log("[phase5-seed] done");
}

main()
  .catch((err) => {
    console.error("[phase5-seed] failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });