// Probe: show recent activity on the book's pages — what got a new videoUrl?
// Run via:  railway run -- node scripts/recent-pages.mjs
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const bookId = process.argv[2] ?? "cmu5mod660003pb1553fnqaur";
const sinceMin = Number(process.argv[3] ?? 30);
const cutoff = new Date(Date.now() - sinceMin * 60_000);

// pages with recent video updates
const recentVideo = await prisma.page.findMany({
  where: { bookId, updatedAt: { gte: cutoff } },
  select: { pageNum: true, status: true, videoUrl: true, regenerationCount: true, updatedAt: true },
  orderBy: { pageNum: "asc" }
});
console.log("updated in last", sinceMin, "min:", recentVideo.length);
for (const p of recentVideo) {
  console.log(p.pageNum, p.status, "regen", p.regenerationCount, "video:", p.videoUrl ? p.videoUrl.slice(0, 60) + "…" : "none", p.updatedAt.toISOString());
}

// pages currently REGENERATING oldest first
const regen = await prisma.page.findMany({
  where: { bookId, status: "REGENERATING" },
  select: { pageNum: true, regenerationCount: true, updatedAt: true },
  orderBy: { updatedAt: "asc" },
  take: 10
});
console.log("\noldest 10 REGENERATING:");
for (const p of regen) {
  console.log(p.pageNum, "regen", p.regenerationCount, p.updatedAt.toISOString());
}

await prisma.$disconnect();
