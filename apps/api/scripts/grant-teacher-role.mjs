// Grants the 'teacher' role to the founder/admin user so the SCHOOL
// teacher flow is testable. Idempotent.
//
// Run from apps/api/ so Prisma auto-loads .env:
//   node scripts/grant-teacher-role.mjs [email]

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TARGET_EMAIL = process.argv[2] ?? "founder@animbook.app";

async function main() {
  const user = await prisma.user.findUnique({
    where: { email: TARGET_EMAIL },
    select: { id: true, email: true, name: true, roles: true }
  });
  if (!user) {
    console.error(`No user found for email ${TARGET_EMAIL}`);
    process.exit(1);
  }
  if (user.roles.includes("teacher")) {
    console.log(`${user.email} already has the 'teacher' role.`);
    return;
  }
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { roles: [...user.roles, "teacher"] },
    select: { id: true, email: true, roles: true }
  });
  console.log(`Granted 'teacher' to ${updated.email}. Roles now:`, updated.roles);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
