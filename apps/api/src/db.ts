import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __animbookPrisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  globalThis.__animbookPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "production" ? ["warn", "error"] : ["warn", "error"]
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__animbookPrisma = prisma;
}