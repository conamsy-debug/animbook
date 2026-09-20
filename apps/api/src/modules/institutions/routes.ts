/**
 * AnimBook INSTITUTIONS — schools / orgs that seat EDU students.
 *
 *   GET    /api/institutions
 *   POST   /api/institutions                       — create (platform_admin only)
 *   GET    /api/institutions/:id
 *   PATCH  /api/institutions/:id                   — update name / seatCount / license
 *   POST   /api/institutions/:id/seats             — invite a seat (email → userId)
 *   DELETE /api/institutions/:id/seats/:userId     — release a seat
 *   GET    /api/institutions/:id/seats             — list seated students
 *
 * Seats are tracked via a JSON column on Institution — `{ studentIds: string[] }`.
 * Keeping it simple avoids a separate table while still letting us count seats
 * and bound enrollment. The license_expires_at column lets us implement a
 * billing gate later without a migration.
 */
import type { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import { authMiddleware, requireUserId, type AuthedRequest } from "../../auth/middleware.js";
import { prisma } from "../../db.js";

const router = Router();
router.use(authMiddleware);

interface SeatInfo {
  studentIds: string[];
}
function readSeats(json: unknown): string[] {
  if (json && typeof json === "object" && "studentIds" in json && Array.isArray((json as SeatInfo).studentIds)) {
    return (json as SeatInfo).studentIds.filter((id): id is string => typeof id === "string");
  }
  return [];
}

router.get("/", async (_req: AuthedRequest, res: Response) => {
  const items = await prisma.institution.findMany({
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, type: true, seatCount: true, adminUserId: true, licenseExpiresAt: true, updatedAt: true }
  });
  res.json({ items });
});

const createSchema = z.object({
  name: z.string().min(1).max(160),
  type: z.enum(["SCHOOL", "UNIVERSITY", "CORPORATE"]).default("SCHOOL"),
  seatCount: z.number().int().min(1).max(10000).default(30)
});

router.post("/", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { roles: true } });
  if (!user?.roles?.includes("platform_admin")) {
    res.status(403).json({ error: "Only platform admins can create institutions" });
    return;
  }
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid institution", details: parsed.error.flatten() });
    return;
  }
  const inst = await prisma.institution.create({
    data: {
      name: parsed.data.name,
      type: parsed.data.type,
      seatCount: parsed.data.seatCount,
      adminUserId: userId,
      lmsIntegration: { studentIds: [] }
    }
  });
  res.status(201).json(inst);
});

router.get("/:id", async (req: AuthedRequest, res: Response) => {
  const id = req.params["id"];
  if (typeof id !== "string") {
    res.status(400).json({ error: "Missing id" });
    return;
  }
  const inst = await prisma.institution.findUnique({ where: { id } });
  if (!inst) {
    res.status(404).json({ error: "Institution not found" });
    return;
  }
  res.json({ institution: inst, seatedUserIds: readSeats(inst.lmsIntegration) });
});

const patchSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  seatCount: z.number().int().min(1).max(10000).optional(),
  licenseExpiresAt: z.string().datetime().nullable().optional()
});

router.patch("/:id", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const id = req.params["id"];
  if (typeof id !== "string") {
    res.status(400).json({ error: "Missing id" });
    return;
  }
  const inst = await prisma.institution.findUnique({ where: { id } });
  if (!inst) {
    res.status(404).json({ error: "Institution not found" });
    return;
  }
  if (inst.adminUserId !== userId) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { roles: true } });
    if (!user?.roles?.includes("platform_admin")) {
      res.status(403).json({ error: "Only the institution admin can edit it" });
      return;
    }
  }
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid patch", details: parsed.error.flatten() });
    return;
  }
  const data: { name?: string; seatCount?: number; licenseExpiresAt?: Date | null } = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.seatCount !== undefined) data.seatCount = parsed.data.seatCount;
  if (parsed.data.licenseExpiresAt !== undefined) {
    data.licenseExpiresAt = parsed.data.licenseExpiresAt ? new Date(parsed.data.licenseExpiresAt) : null;
  }
  const updated = await prisma.institution.update({ where: { id }, data });
  res.json({ ...updated, seatedUserIds: readSeats(updated.lmsIntegration) });
});

const seatSchema = z.object({ studentEmail: z.string().email() });

router.post("/:id/seats", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const id = req.params["id"];
  if (typeof id !== "string") {
    res.status(400).json({ error: "Missing id" });
    return;
  }
  const inst = await prisma.institution.findUnique({ where: { id } });
  if (!inst) {
    res.status(404).json({ error: "Institution not found" });
    return;
  }
  if (inst.adminUserId !== userId) {
    res.status(403).json({ error: "Only the institution admin can seat students" });
    return;
  }
  const parsed = seatSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid seat payload", details: parsed.error.flatten() });
    return;
  }
  const student = await prisma.user.findUnique({ where: { email: parsed.data.studentEmail.toLowerCase() } });
  if (!student) {
    res.status(404).json({ error: "No AnimBook account for that email yet" });
    return;
  }
  const seats = readSeats(inst.lmsIntegration);
  if (seats.includes(student.id)) {
    res.json({ ok: true, alreadySeated: true, seatedUserIds: seats });
    return;
  }
  if (seats.length >= inst.seatCount) {
    res.status(409).json({ error: "Seat limit reached. Increase seatCount to add more." });
    return;
  }
  const next = { studentIds: [...seats, student.id] };
  await prisma.institution.update({ where: { id }, data: { lmsIntegration: next } });
  res.status(201).json({ ok: true, seatedUserIds: next.studentIds });
});

router.delete("/:id/seats/:studentId", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const id = req.params["id"];
  const studentId = req.params["studentId"];
  if (typeof id !== "string" || typeof studentId !== "string") {
    res.status(400).json({ error: "Missing id or studentId" });
    return;
  }
  const inst = await prisma.institution.findUnique({ where: { id } });
  if (!inst) {
    res.status(404).json({ error: "Institution not found" });
    return;
  }
  if (inst.adminUserId !== userId) {
    res.status(403).json({ error: "Only the institution admin can release seats" });
    return;
  }
  const seats = readSeats(inst.lmsIntegration).filter((s) => s !== studentId);
  await prisma.institution.update({ where: { id }, data: { lmsIntegration: { studentIds: seats } } });
  res.json({ ok: true, seatedUserIds: seats });
});

router.get("/:id/seats", async (req: AuthedRequest, res: Response) => {
  const id = req.params["id"];
  if (typeof id !== "string") {
    res.status(400).json({ error: "Missing id" });
    return;
  }
  const inst = await prisma.institution.findUnique({ where: { id } });
  if (!inst) {
    res.status(404).json({ error: "Institution not found" });
    return;
  }
  const seats = readSeats(inst.lmsIntegration);
  const users = seats.length === 0 ? [] : await prisma.user.findMany({
    where: { id: { in: seats } },
    select: { id: true, name: true, email: true }
  });
  res.json({ seatedUserIds: seats, students: users });
});

export default router;
