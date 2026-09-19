import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const total = await p.page.count({ where: { bookId: "cmu5mod660003pb1553fnqaur" } });
const haveAudio = await p.page.count({ where: { bookId: "cmu5mod660003pb1553fnqaur", audioUrl: { not: null } } });
const failed = await p.page.count({ where: { bookId: "cmu5mod660003pb1553fnqaur", audioStatus: "FAILED" } });
const ready = await p.page.count({ where: { bookId: "cmu5mod660003pb1553fnqaur", audioStatus: "READY" } });
console.log("total pages:", total);
console.log("with audioUrl:", haveAudio);
console.log("audioStatus=READY:", ready);
console.log("audioStatus=FAILED:", failed);

const recent = await p.page.findMany({
  where: { bookId: "cmu5mod660003pb1553fnqaur", audioUrl: { not: null } },
  select: { pageNum: true, audioUrl: true, audioStatus: true },
  orderBy: { pageNum: "asc" },
  take: 5,
});
console.log("first 5 with audio:");
for (const r of recent) {
  console.log("  page " + r.pageNum + ": status=" + r.audioStatus + " url=" + (r.audioUrl || "").slice(0, 60) + "...");
}

await p.$disconnect();