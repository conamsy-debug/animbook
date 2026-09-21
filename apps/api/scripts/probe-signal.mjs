// Probe AnimBook SIGNAL — verify the page renders and the API works.
// We can't auth as the user from CLI, but we can check that the page HTML
// loads and that the signal API returns sane shape from an unauth probe.
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";

const envText = readFileSync(".env", "utf-8");
const dbUrl = envText.match(/DATABASE_URL="?([^"\n]+)"?/)?.[1]?.replace(/[?&]channel_binding=[^&]+/g, "");
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

// 1. How many pageSignalEvent rows exist?
const eventCount = await prisma.pageSignalEvent.count();
console.log("Total pageSignalEvent rows:", eventCount);

// 2. Per-book breakdown
const grouped = await prisma.pageSignalEvent.groupBy({
  by: ["bookId"],
  _count: { _all: true },
  _avg: { dwellMs: true }
});
console.log("Per-book signal counts:");
for (const g of grouped) {
  const book = await prisma.book.findUnique({ where: { id: g.bookId }, select: { slug: true, title: true } });
  console.log(`  - ${book?.slug} · ${book?.title} · ${g._count._all} events · avg dwell ${Math.round(g._avg.dwellMs ?? 0)}ms`);
}

// 3. EDU books (so we know what slugs the dashboard can pick)
const eduBooks = await prisma.book.findMany({
  where: { vertical: "EDU" },
  select: { slug: true, title: true, totalPages: true }
});
console.log("EDU books:", eduBooks.length);
for (const b of eduBooks) console.log("  -", b.slug, "·", b.title, "·", b.totalPages, "pp");

// 4. Unauthed probe of the live API
const apiBase = envText.match(/API_PUBLIC_URL="?([^"\n]+)"?/)?.[1] ?? "https://api.animbook.com";
const probeBook = eduBooks[0]?.slug ?? "mitosis-a-living-cell-divides";
const r = await fetch(`${apiBase}/api/signal/teacher?bookSlug=${probeBook}`);
console.log("Unauthed signal probe status:", r.status);
const body = await r.text();
console.log("Body (200c):", body.slice(0, 200));

await prisma.$disconnect();
