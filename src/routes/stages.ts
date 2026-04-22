import { Router, Response } from "express";
import { z } from "zod";
import prisma from "../lib/prisma";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { getProjectWithAccess } from "./projects";

const router = Router({ mergeParams: true });

router.use(requireAuth);

const STAGE_COLORS = [
  "#6366f1", "#8b5cf6", "#0ea5e9", "#14b8a6",
  "#f59e0b", "#f43f5e", "#f97316", "#84cc16",
];

const MAX_STAGES = 20;

const stageSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  durationWeeks: z.number().int().min(1).optional(),
  startDate: z.string().datetime({ offset: true }).optional().nullable(),
  endDate: z.string().datetime({ offset: true }).optional().nullable(),
  order: z.number().int().min(0).optional(),
});

const reorderSchema = z.object({
  order: z.array(z.string()),
});

function deriveWeeksAndEnd(input: {
  startDate?: string | null;
  endDate?: string | null;
  durationWeeks?: number;
}): { durationWeeks?: number; endDate?: Date | null } {
  const { startDate, endDate, durationWeeks } = input;

  if (startDate && endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const weeks = Math.max(1, Math.round((end.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000)));
    return { durationWeeks: weeks, endDate: end };
  }

  if (startDate && durationWeeks) {
    const start = new Date(startDate);
    const end = new Date(start.getTime() + durationWeeks * 7 * 24 * 60 * 60 * 1000);
    return { durationWeeks, endDate: end };
  }

  if (durationWeeks) {
    return { durationWeeks };
  }

  return {};
}

// GET /projects/:projectId/stages
router.get("/", async (req: AuthRequest, res: Response) => {
  const projectId = req.params["projectId"] as string;
  const project = await getProjectWithAccess(projectId, req.user!.sub, req.user!.role);
  if (!project) {
    res.status(404).json({ code: "NOT_FOUND", message: "Project not found", hint: "" });
    return;
  }

  const stages = await prisma.stage.findMany({
    where: { projectId },
    orderBy: { order: "asc" },
  });
  res.json(stages);
});

// POST /projects/:projectId/stages
router.post("/", async (req: AuthRequest, res: Response) => {
  const projectId = req.params["projectId"] as string;
  const project = await getProjectWithAccess(projectId, req.user!.sub, req.user!.role);
  if (!project) {
    res.status(404).json({ code: "NOT_FOUND", message: "Project not found", hint: "" });
    return;
  }

  const count = await prisma.stage.count({ where: { projectId } });
  if (count >= MAX_STAGES) {
    res.status(400).json({ code: "STAGE_LIMIT", message: `Maximum ${MAX_STAGES} stages per project`, hint: "" });
    return;
  }

  const parsed = stageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: "VALIDATION_ERROR", message: "Invalid input", hint: parsed.error.flatten() });
    return;
  }

  const { title, description, startDate, endDate, durationWeeks, order } = parsed.data;

  const derived = deriveWeeksAndEnd({ startDate, endDate, durationWeeks });

  // Auto-pick next unused color
  const usedColors = await prisma.stage.findMany({ where: { projectId }, select: { color: true } });
  const usedSet = new Set(usedColors.map((s) => s.color));
  const autoColor = STAGE_COLORS.find((c) => !usedSet.has(c)) ?? STAGE_COLORS[count % STAGE_COLORS.length]!;

  const nextOrder = order ?? count;

  const stage = await prisma.stage.create({
    data: {
      projectId,
      title,
      description: description ?? null,
      color: parsed.data.color ?? autoColor,
      startDate: startDate ? new Date(startDate) : null,
      endDate: derived.endDate ?? null,
      durationWeeks: derived.durationWeeks ?? null,
      order: nextOrder,
    },
  });
  res.status(201).json(stage);
});

// PUT /projects/:projectId/stages/reorder  (must be before /:stageId)
router.put("/reorder", async (req: AuthRequest, res: Response) => {
  const projectId = req.params["projectId"] as string;
  const project = await getProjectWithAccess(projectId, req.user!.sub, req.user!.role);
  if (!project) {
    res.status(404).json({ code: "NOT_FOUND", message: "Project not found", hint: "" });
    return;
  }

  const parsed = reorderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: "VALIDATION_ERROR", message: "Invalid input", hint: parsed.error.flatten() });
    return;
  }

  await prisma.$transaction(
    parsed.data.order.map((id, idx) =>
      prisma.stage.update({ where: { id }, data: { order: idx } })
    )
  );

  const stages = await prisma.stage.findMany({ where: { projectId }, orderBy: { order: "asc" } });
  res.json(stages);
});

// PUT /projects/:projectId/stages/:stageId
router.put("/:stageId", async (req: AuthRequest, res: Response) => {
  const { projectId, stageId } = req.params as { projectId: string; stageId: string };
  const project = await getProjectWithAccess(projectId, req.user!.sub, req.user!.role);
  if (!project) {
    res.status(404).json({ code: "NOT_FOUND", message: "Project not found", hint: "" });
    return;
  }

  const stage = await prisma.stage.findFirst({ where: { id: stageId, projectId } });
  if (!stage) {
    res.status(404).json({ code: "NOT_FOUND", message: "Stage not found", hint: "" });
    return;
  }

  const parsed = stageSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: "VALIDATION_ERROR", message: "Invalid input", hint: parsed.error.flatten() });
    return;
  }

  const { title, description, color, startDate, endDate, durationWeeks, order } = parsed.data;

  const derived = deriveWeeksAndEnd({
    startDate: startDate ?? (stage.startDate?.toISOString() ?? null),
    endDate: endDate ?? (stage.endDate?.toISOString() ?? null),
    durationWeeks: durationWeeks ?? (stage.durationWeeks ?? undefined),
  });

  const updated = await prisma.stage.update({
    where: { id: stageId },
    data: {
      ...(title !== undefined && { title }),
      ...(description !== undefined && { description: description ?? null }),
      ...(color !== undefined && { color }),
      ...(startDate !== undefined && { startDate: startDate ? new Date(startDate) : null }),
      ...(derived.endDate !== undefined && { endDate: derived.endDate }),
      ...(derived.durationWeeks !== undefined && { durationWeeks: derived.durationWeeks }),
      ...(order !== undefined && { order }),
    },
  });
  res.json(updated);
});

// DELETE /projects/:projectId/stages/:stageId
router.delete("/:stageId", async (req: AuthRequest, res: Response) => {
  const { projectId, stageId } = req.params as { projectId: string; stageId: string };
  const project = await getProjectWithAccess(projectId, req.user!.sub, req.user!.role);
  if (!project) {
    res.status(404).json({ code: "NOT_FOUND", message: "Project not found", hint: "" });
    return;
  }

  const stage = await prisma.stage.findFirst({ where: { id: stageId, projectId } });
  if (!stage) {
    res.status(404).json({ code: "NOT_FOUND", message: "Stage not found", hint: "" });
    return;
  }

  await prisma.stage.delete({ where: { id: stageId } });
  res.status(204).send();
});

export default router;
