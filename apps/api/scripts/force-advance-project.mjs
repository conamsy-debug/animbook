#!/usr/bin/env node
// Force-advance a project past the legacy GENERATING gate so the Studio
// can land at step 5 (Review) — used when splitPipeline=true is flipped on
// a book whose legacy pipeline was paused (e.g. Runway credits at 0).
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const [, , projectIdRaw] = process.argv;
if (!projectIdRaw) {
  console.error("usage: force-advance-project.mjs <projectId>");
  process.exit(1);
}

const before = await prisma.studioProject.findUnique({
  where: { id: projectIdRaw },
  select: { id: true, status: true, currentStage: true, book: { select: { id: true, title: true, splitPipeline: true } } },
});
console.log("before:", before);
if (!before) {
  console.error("project not found");
  process.exit(1);
}

const after = await prisma.studioProject.update({
  where: { id: projectIdRaw },
  data: { status: "REVIEW" },
});
console.log("after:", { status: after.status, currentStage: after.currentStage });

await prisma.$disconnect();