// Introspect Neon — row counts using actual Prisma model accessors.
import { PrismaClient } from "@prisma/client";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
const db = new PrismaClient();

const accessors = {
  User: "user",
  Publisher: "publisher",
  Book: "book",
  Page: "page",
  LibraryEntry: "libraryEntry",
  Subscription: "subscription",
  BookBrain: "bookBrain",
  Checkpoint: "checkpoint",
  CheckpointResponse: "checkpointResponse",
  Achievement: "achievement",
  ReviewDecision: "reviewDecision",
  RoyaltyEntry: "royaltyEntry",
  MemoryProfile: "memoryProfile",
  OracleTree: "oracleTree",
  OracleNode: "oracleNode",
  LiveSession: "liveSession",
  LiveEvent: "liveEvent",
  TranslationGloss: "translationGloss",
  World: "world",
  WorldMember: "worldMember",
  StageRound: "stageRound",
  StageContribution: "stageContribution",
  ApiKey: "apiKey",
  PageSignalEvent: "pageSignalEvent",
  Institution: "institution",
  StudioProject: "studioProject",
  GenerationJob: "generationJob",
  ArchiveProject: "archiveProject",
  ArchiveConsent: "archiveConsent",
  ArchiveCulturalNote: "archiveCulturalNote",
  Classroom: "classroom",
  ClassroomMembership: "classroomMembership",
  ClassroomAssignment: "classroomAssignment",
  ClassroomSubmission: "classroomSubmission",
  DreamSession: "dreamSession",
  CompanionLink: "companionLink",
  CompanionSession: "companionSession"
};

console.log("URL host:", new URL(url).host);

console.log("\n=== Row counts ===");
let total = 0;
for (const [name, acc] of Object.entries(accessors)) {
  try {
    const c = await db[acc].count();
    if (c > 0) console.log(`  ${name.padEnd(24)} → ${c}`);
    total += c;
  } catch (err) {
    console.log(`  ${name.padEnd(24)} → ERR: ${err.message.split('\n')[0].slice(0,80)}`);
  }
}
console.log(`  ${"TOTAL".padEnd(24)} → ${total}`);

await db.$disconnect();
