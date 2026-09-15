/**
 * One-shot helper that promotes the demo user to all the roles Phase 5
 * relies on (archive_steward, teacher). Idempotent.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const demo = await prisma.user.findUnique({ where: { email: "demo@animbook.com" } });
  if (!demo) {
    console.error("[phase5-promote] demo user missing — run npm run db:seed first");
    process.exit(1);
  }
  await prisma.user.update({
    where: { id: demo.id },
    data: {
      roles: ["platform_admin", "theological_advisor", "publisher_admin", "archive_steward", "teacher"]
    }
  });
  console.log("[phase5-promote] demo user promoted to archive_steward + teacher");
}

main()
  .catch((err) => {
    console.error("[phase5-promote] failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });