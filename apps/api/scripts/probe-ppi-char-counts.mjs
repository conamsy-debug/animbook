import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const pages = await p.page.findMany({
  where: { bookId: "cmu5mod660003pb1553fnqaur" },
  select: { pageNum: true, textExcerpt: true },
});
const lengths = pages.map(pg => (pg.textExcerpt || "").length);
const total = lengths.reduce((a, b) => a + b, 0);
const avg = Math.round(total / lengths.length);
const min = Math.min(...lengths);
const max = Math.max(...lengths);
console.log("pages:", pages.length);
console.log("chars: total=" + total + " avg=" + avg + " min=" + min + " max=" + max);
// ElevenLabs ~$0.18 per 1k chars on the multilingual_v2 model
console.log("ElevenLabs estimate: $" + (total * 0.00018).toFixed(2) + " (~$" + (total * 0.0003).toFixed(2) + " with retry buffer)");
console.log("Sample pages:");
for (let i = 0; i < Math.min(5, pages.length); i++) {
  console.log("  page " + pages[i].pageNum + " (" + lengths[i] + " chars): " + (pages[i].textExcerpt || "").slice(0, 80));
}
await p.$disconnect();