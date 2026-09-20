/**
 * AnimBook SCHOOL — student creators + classroom library.
 *
 *   - GET/POST  /api/school/classrooms
 *   - POST      /api/school/classrooms/:slug/members     (invite students)
 *   - GET       /api/school/classrooms/:slug/library     (the curated shelf)
 *   - GET/POST  /api/school/classrooms/:slug/assignments
 *   - POST      /api/school/assignments/:id/submit       (student turns in a StudioProject)
 *   - GET       /api/school/me                            (student dashboard)
 *
 * Teacher role: 'platform_admin' or 'teacher'.
 * Student role: 'student'.
 */
import type { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import { authMiddleware, requireUserId, type AuthedRequest } from "../../auth/middleware.js";
import { prisma } from "../../db.js";
import { markAsSchoolAccount } from "../../services/accountStanding.js";

const router = Router();
router.use(authMiddleware);

async function getMembership(userId: string, classroomId: string) {
  return prisma.classroomMembership.findUnique({
    where: { classroomId_studentId: { classroomId, studentId: userId } }
  });
}

router.get("/classrooms", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (user?.roles.includes("teacher") || user?.roles.includes("platform_admin")) {
    const classrooms = await prisma.classroom.findMany({
      where: user.roles.includes("platform_admin") ? undefined : { teacherId: userId },
      include: {
        _count: { select: { members: true, assignments: true } }
      },
      orderBy: { updatedAt: "desc" }
    });
    res.json({ items: classrooms });
    return;
  }
  const memberships = await prisma.classroomMembership.findMany({
    where: { studentId: userId },
    include: {
      classroom: {
        include: { _count: { select: { members: true, assignments: true } } }
      }
    }
  });
  res.json({ items: memberships.map((m) => m.classroom) });
});

const createSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/, "slug must be kebab-case"),
  schoolName: z.string().optional(),
  gradeBand: z.string().optional()
});

router.post("/classrooms", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.roles.includes("teacher") && !user?.roles.includes("platform_admin")) {
    res.status(403).json({ error: "Only teachers can create classrooms" });
    return;
  }
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid classroom", details: parsed.error.flatten() });
    return;
  }
  const classroom = await prisma.classroom.create({
    data: {
      name: parsed.data.name,
      slug: parsed.data.slug,
      schoolName: parsed.data.schoolName ?? null,
      gradeBand: parsed.data.gradeBand ?? null,
      teacherId: userId
    }
  });
  res.status(201).json(classroom);
});

router.get("/classrooms/:slug", async (req: AuthedRequest, res: Response) => {
  const slug = req.params["slug"];
  if (typeof slug !== "string") {
    res.status(400).json({ error: "Missing slug" });
    return;
  }
  const userId = requireUserId(req);
  const classroom = await prisma.classroom.findUnique({
    where: { slug },
    include: {
      members: { include: { student: { select: { id: true, name: true, email: true } } } },
      assignments: {
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { submissions: true } } }
      },
      teacher: { select: { id: true, name: true, email: true } }
    }
  });
  if (!classroom) {
    res.status(404).json({ error: "Classroom not found" });
    return;
  }
  const isTeacher = classroom.teacherId === userId;
  const isMember = await getMembership(userId, classroom.id);
  if (!isTeacher && !isMember) {
    res.status(403).json({ error: "Not a member of this classroom" });
    return;
  }
  res.json({ classroom, role: isTeacher ? "TEACHER" : isMember?.role ?? "STUDENT" });
});

const inviteSchema = z.object({ studentEmail: z.string().email() });

router.post("/classrooms/:slug/members", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const slug = req.params["slug"];
  if (typeof slug !== "string") {
    res.status(400).json({ error: "Missing slug" });
    return;
  }
  const classroom = await prisma.classroom.findUnique({ where: { slug } });
  if (!classroom) {
    res.status(404).json({ error: "Classroom not found" });
    return;
  }
  if (classroom.teacherId !== userId) {
    res.status(403).json({ error: "Only the teacher can invite members" });
    return;
  }
  const parsed = inviteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid invite payload", details: parsed.error.flatten() });
    return;
  }
  const student = await prisma.user.findUnique({ where: { email: parsed.data.studentEmail } });
  if (!student) {
    res.status(404).json({ error: "No AnimBook account for that email yet" });
    return;
  }
  const membership = await prisma.classroomMembership.upsert({
    where: { classroomId_studentId: { classroomId: classroom.id, studentId: student.id } },
    create: { classroomId: classroom.id, studentId: student.id, role: "STUDENT" },
    update: { role: "STUDENT" }
  });
  // Joining a classroom is what makes an account a school account: community
  // writing and private messaging go off from this moment and stay off.
  await markAsSchoolAccount(student.id);
  res.status(201).json({ membership });
});

router.get("/classrooms/:slug/library", async (req: Request, res: Response) => {
  const slug = req.params["slug"];
  if (typeof slug !== "string") {
    res.status(400).json({ error: "Missing slug" });
    return;
  }
  const classroom = await prisma.classroom.findUnique({ where: { slug } });
  if (!classroom) {
    res.status(404).json({ error: "Classroom not found" });
    return;
  }
  const books = classroom.libraryBookIds.length > 0
    ? await prisma.book.findMany({
        where: { id: { in: classroom.libraryBookIds }, status: "PUBLISHED" },
        select: {
          id: true,
          slug: true,
          title: true,
          author: true,
          vertical: true,
          language: true,
          totalPages: true,
          coverUrl: true,
          synopsis: true
        }
      })
    : [];
  res.json({ items: books });
});

const assignmentSchema = z.object({
  title: z.string().min(1),
  brief: z.string().min(1).max(2000),
  rubric: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  dueAt: z.string().datetime().optional()
});

router.post("/classrooms/:slug/assignments", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const slug = req.params["slug"];
  if (typeof slug !== "string") {
    res.status(400).json({ error: "Missing slug" });
    return;
  }
  const classroom = await prisma.classroom.findUnique({ where: { slug } });
  if (!classroom) {
    res.status(404).json({ error: "Classroom not found" });
    return;
  }
  if (classroom.teacherId !== userId) {
    res.status(403).json({ error: "Only the teacher can post assignments" });
    return;
  }
  const parsed = assignmentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid assignment", details: parsed.error.flatten() });
    return;
  }
  const assignment = await prisma.classroomAssignment.create({
    data: {
      classroomId: classroom.id,
      title: parsed.data.title,
      brief: parsed.data.brief,
      rubric: parsed.data.rubric ?? undefined,
      dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null
    }
  });
  res.status(201).json({ assignment });
});

const submissionSchema = z.object({
  studioProjectId: z.string().optional(),
  pageCount: z.number().int().min(1)
});

router.post("/assignments/:id/submit", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const id = req.params["id"];
  if (typeof id !== "string") {
    res.status(400).json({ error: "Missing assignment id" });
    return;
  }
  const parsed = submissionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid submission", details: parsed.error.flatten() });
    return;
  }
  const assignment = await prisma.classroomAssignment.findUnique({
    where: { id },
    include: { classroom: { select: { id: true, teacherId: true } } }
  });
  if (!assignment) {
    res.status(404).json({ error: "Assignment not found" });
    return;
  }
  const isTeacher = assignment.classroom.teacherId === userId;
  const member = isTeacher ? null : await getMembership(userId, assignment.classroom.id);
  if (!isTeacher && !member) {
    res.status(403).json({ error: "Only classroom members can submit" });
    return;
  }
  const submission = await prisma.classroomSubmission.create({
    data: {
      assignmentId: assignment.id,
      studentId: userId,
      studioProjectId: parsed.data.studioProjectId ?? null,
      pageCount: parsed.data.pageCount
    }
  });
  res.status(201).json({ submission });
});

router.get("/me", async (req: AuthedRequest, res: Response) => {
  const userId = requireUserId(req);
  const [user, memberships] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, roles: true, accountKind: true }
    }),
    prisma.classroomMembership.findMany({
      where: { studentId: userId },
      include: {
        classroom: {
          include: {
            assignments: {
              orderBy: { createdAt: "desc" },
              include: { submissions: { where: { studentId: userId } } }
            }
          }
        }
      }
    })
  ]);
  res.json({ user, items: memberships });
});

export default router;