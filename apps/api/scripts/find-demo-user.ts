/**
 * Find the demo book owner by email (conamsy@gmail.com →
 * echadmediahouse@gmail.com → stop). Read-only — never writes.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function findOne(email: string) {
  const u: { id: string; email: string; roles: string[]; voiceStatus: string | null } | null = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, roles: true, voiceStatus: true }
  });
  return u;
}

async function main() {
  for (const email of ["conamsy@gmail.com", "echadmediahouse@gmail.com"]) {
    const u = await findOne(email);
    if (u) {
      console.log(JSON.stringify({ found: true, email, user: u }, null, 2));
      await prisma.$disconnect();
      process.exit(0);
    } else {
      console.log(JSON.stringify({ found: false, email }));
    }
  }
  await prisma.$disconnect();
  console.log("NEITHER_EMAIL_FOUND");
  process.exit(2);
}

main().catch((err) => {
  console.error("unexpected:", err);
  process.exit(1);
});