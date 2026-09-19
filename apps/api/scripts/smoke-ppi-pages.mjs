#!/usr/bin/env node
// Probe page-state distribution on Practical Physical Immortality (split-flipped).
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const book = await prisma.book.findUnique({
  where: { id: "cmu5mod660003pb1553fnqaur" },
  select: { id: true, title: true, splitPipeline: true, totalPages: true },
});
console.log("book:", book);

const pages = await prisma.page.findMany({
  where: { bookId: book.id },
  select: {
    pageNum: true,
    stillStatus: true,
    clipStatus: true,
    audioStatus: true,
    motionTier: true,
    posterUrl: true,
    videoUrl: true,
    audioUrl: true,
  },
  orderBy: { pageNum: "asc" },
});

console.log("total pages:", pages.length);

const tally = (key) => {
  const counts = {};
  for (const p of pages) counts[p[key]] = (counts[p[key]] ?? 0) + 1;
  return counts;
};

for (const k of ["stillStatus", "clipStatus", "audioStatus", "motionTier"]) {
  console.log(`${k}:`, tally(k));
}

// Pages that are "ready" but missing the actual asset URL
const readyButEmpty = pages.filter(
  (p) =>
    (p.clipStatus === "READY" || p.clipStatus === "APPROVED") && !p.videoUrl,
);
console.log("clip READY/APPROVED but videoUrl null:", readyButEmpty.length);
if (readyButEmpty.length) {
  console.log("examples:", readyButEmpty.slice(0, 5).map((p) => p.pageNum));
}

const stillReadyEmpty = pages.filter(
  (p) =>
    (p.stillStatus === "READY" || p.stillStatus === "APPROVED") && !p.posterUrl,
);
console.log("still READY/APPROVED but posterUrl null:", stillReadyEmpty.length);

const audioReadyEmpty = pages.filter(
  (p) => p.audioStatus === "READY" && !p.audioUrl,
);
console.log("audio READY but audioUrl null:", audioReadyEmpty.length);

// How many pages would clear the publish gate today?
const gateClear = pages.filter(
  (p) =>
    p.stillStatus === "APPROVED" &&
    p.clipStatus === "APPROVED" &&
    p.audioStatus === "READY",
);
console.log("publish-gate clear:", gateClear.length, "of", pages.length);

// Gate blocks: what breaks?
const blocked = pages.filter(
  (p) =>
    !(
      p.stillStatus === "APPROVED" &&
      p.clipStatus === "APPROVED" &&
      p.audioStatus === "READY"
    ),
);
console.log("publish-gate blocked:", blocked.length);
const why = {};
for (const p of blocked) {
  const reasons = [];
  if (p.stillStatus !== "APPROVED") reasons.push(`still=${p.stillStatus}`);
  if (p.clipStatus !== "APPROVED") reasons.push(`clip=${p.clipStatus}`);
  if (p.audioStatus !== "READY") reasons.push(`audio=${p.audioStatus}`);
  const k = reasons.join(",");
  why[k] = (why[k] ?? 0) + 1;
}
console.log("block reasons:", why);

await prisma.$disconnect();