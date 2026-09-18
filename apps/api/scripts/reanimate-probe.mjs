// Probe: list flagged pages on Practical Physical Immortality. Just logging —
// no mutations. Invoke with: railway run -- node scripts/reanimate-probe.mjs
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const projectId = process.argv[2] ?? "cmu5modam0005pb15hnka8rj7";
const project = await prisma.studioProject.findUnique({
  where: { id: projectId },
  select: { id: true, bookId: true, name: true }
});
if (!project) { console.error("no project"); process.exit(1); }
console.log("project", project.name, "bookId", project.bookId);
const flagged = await prisma.page.findMany({
  where: { bookId: project.bookId, status: "FLAGGED" },
  select: { pageNum: true, status: true, directionNote: true, regenerationCount: true },
  orderBy: { pageNum: "asc" }
});
console.log("flagged count:", flagged.length);
console.log("pages:", flagged.map(p => p.pageNum).join(","));
console.log("regen counts:", [...new Set(flagged.map(p => p.regenerationCount))].sort());
await prisma.$disconnect();
