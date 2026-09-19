import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

// Confirm table is reachable
const count = await p.usageEvent.count();
console.log("usage_events rows:", count);

// Insert a sample row to verify the schema is correct
const sample = await p.usageEvent.create({
  data: {
    userId: "cmu46p7h80000pk15wfnz3so0",  // cosmas user
    bookId: "cmu5mod660003pb1553fnqaur",  // PPI
    kind: "TEST",
    provider: "TEST",
    units: 1,
    unitCostUsd: 0.01,
    totalUsd: 0.01,
    status: "SUCCESS",
    metadata: { probe: true }
  },
});
console.log("inserted:", sample.id);

// Clean up the test row
await p.usageEvent.delete({ where: { id: sample.id } });
console.log("cleaned up test row");

await p.$disconnect();