import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

// Confirm the new column exists and defaults to FALSE
const sample = await p.page.findFirst({
  select: {
    id: true,
    pageNum: true,
    motionTier: true,
    motionTierOverridden: true,
  },
});
console.log("sample page:", sample);

// Count pages with the new flag set (should be 0 — nothing flipped it yet)
const flagged = await p.page.count({ where: { motionTierOverridden: true } });
console.log("pages with motionTierOverridden=true:", flagged);

// Sanity: column is on every existing row, all FALSE
const total = await p.page.count();
console.log("total pages:", total);

await p.$disconnect();