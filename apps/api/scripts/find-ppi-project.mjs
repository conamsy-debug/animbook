#!/usr/bin/env node
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const project = await prisma.studioProject.findFirst({
  where: { book: { title: { contains: "Practical Physical" } } },
  select: { id: true, status: true, currentStage: true, book: { select: { id: true, title: true, splitPipeline: true } } },
});
console.log(JSON.stringify(project, null, 2));
await prisma.$disconnect();