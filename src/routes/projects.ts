import { Router, Response } from "express";
import { z } from "zod";
import prisma from "../lib/prisma";
import { requireAuth, AuthRequest } from "../middleware/auth";

const router = Router();

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  actualStartDate: z.string().datetime({ offset: true }).optional().nullable(),
  actualEndDate: z.string().datetime({ offset: true }).optional().nullable(),
});

router.use(requireAuth);

router.get("/", async (req: AuthRequest, res: Response) => {
  const userId = req.user!.sub;

  if (req.user!.role === "manager") {
    const managed = await prisma.projectManager.findMany({
      where: { managerId: userId },
      include: { project: { include: { _count: { select: { reports: true } } } } },
    });
    const projectIds = managed.map((m) => m.project.id);
    const hoursMap = await calcTotalHoursMap(projectIds);
    res.json(managed.map((m: typeof managed[number]) => ({
      ...m.project,
      reportCount: m.project._count.reports,
      totalHours: hoursMap[m.project.id] ?? 0,
    })));
    return;
  }

  const projects = await prisma.project.findMany({
    where: { ownerId: userId },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { reports: true } } },
  });
  const hoursMap = await calcTotalHoursMap(projects.map((p) => p.id));
  res.json(projects.map((p: typeof projects[number]) => ({
    ...p,
    reportCount: p._count.reports,
    totalHours: hoursMap[p.id] ?? 0,
  })));
});

router.post("/", async (req: AuthRequest, res: Response) => {
  if (req.user!.role !== "supervisor") {
    res.status(403).json({ code: "FORBIDDEN", message: "Only supervisors can create projects", hint: "" });
    return;
  }

  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: "VALIDATION_ERROR", message: "Invalid input", hint: parsed.error.flatten() });
    return;
  }

  const project = await prisma.project.create({
    data: { ...parsed.data, ownerId: req.user!.sub },
  });
  res.status(201).json(project);
});

router.get("/:id", async (req: AuthRequest, res: Response) => {
  const id = req.params["id"] as string;
  const project = await getProjectWithAccess(id, req.user!.sub, req.user!.role);
  if (!project) {
    res.status(404).json({ code: "NOT_FOUND", message: "Project not found", hint: "" });
    return;
  }
  res.json(project);
});

router.patch("/:id", async (req: AuthRequest, res: Response) => {
  if (req.user!.role !== "supervisor") {
    res.status(403).json({ code: "FORBIDDEN", message: "Only supervisors can update projects", hint: "" });
    return;
  }

  const id = req.params["id"] as string;
  const project = await prisma.project.findFirst({ where: { id, ownerId: req.user!.sub } });
  if (!project) {
    res.status(404).json({ code: "NOT_FOUND", message: "Project not found", hint: "" });
    return;
  }

  const parsed = createSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: "VALIDATION_ERROR", message: "Invalid input", hint: parsed.error.flatten() });
    return;
  }

  const { actualStartDate, actualEndDate, ...rest } = parsed.data;
  const updated = await prisma.project.update({
    where: { id },
    data: {
      ...rest,
      ...(actualStartDate !== undefined && { actualStartDate: actualStartDate ? new Date(actualStartDate) : null }),
      ...(actualEndDate !== undefined && { actualEndDate: actualEndDate ? new Date(actualEndDate) : null }),
    },
  });
  res.json(updated);
});

router.delete("/:id", async (req: AuthRequest, res: Response) => {
  if (req.user!.role !== "supervisor") {
    res.status(403).json({ code: "FORBIDDEN", message: "Only supervisors can delete projects", hint: "" });
    return;
  }

  const id = req.params["id"] as string;
  const project = await prisma.project.findFirst({ where: { id, ownerId: req.user!.sub } });
  if (!project) {
    res.status(404).json({ code: "NOT_FOUND", message: "Project not found", hint: "" });
    return;
  }

  const reports = await prisma.report.findMany({ where: { projectId: id }, select: { id: true } });
  const reportIds = reports.map((r) => r.id);

  await prisma.reportImage.deleteMany({ where: { reportId: { in: reportIds } } });
  await prisma.reportJob.deleteMany({ where: { reportId: { in: reportIds } } });
  await prisma.report.deleteMany({ where: { projectId: id } });
  await prisma.projectManager.deleteMany({ where: { projectId: id } });
  await prisma.project.delete({ where: { id } });

  res.status(204).send();
});

async function calcTotalHoursMap(projectIds: string[]): Promise<Record<string, number>> {
  if (projectIds.length === 0) return {};
  const reports = await prisma.report.findMany({
    where: { projectId: { in: projectIds }, status: "done", reportData: { not: null } },
    select: { projectId: true, reportData: true },
  });
  const map: Record<string, number> = {};
  for (const r of reports) {
    if (!r.reportData) continue;
    try {
      const data = JSON.parse(r.reportData) as { workHourTotal?: unknown };
      const h = typeof data.workHourTotal === "number" ? data.workHourTotal : 0;
      map[r.projectId] = (map[r.projectId] ?? 0) + h;
    } catch { /* skip malformed */ }
  }
  return map;
}

async function getProjectWithAccess(projectId: string, userId: string, role: string) {
  if (role === "supervisor") {
    return prisma.project.findFirst({ where: { id: projectId, ownerId: userId } });
  }
  const managed = await prisma.projectManager.findUnique({
    where: { projectId_managerId: { projectId: projectId, managerId: userId } },
  });
  if (!managed) return null;
  return prisma.project.findUnique({ where: { id: projectId } });
}

export { getProjectWithAccess };
export default router;
