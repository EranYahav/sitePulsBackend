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
  dependsOnId: z.string().uuid().optional().nullable(),
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

// The generated Prisma client doesn't know about dependsOnId yet (dev server holds
// the query engine DLL on Windows, blocking `prisma generate`). The migration has
// been applied, so the column exists in the DB — we access dependsOnId via raw SQL
// and use Prisma for everything else (so date typing stays correct).

async function getDependsOnId(stageId: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ dependsOnId: string | null }>>`
    SELECT "dependsOnId" FROM "Stage" WHERE id = ${stageId}
  `;
  return rows[0]?.dependsOnId ?? null;
}

async function setDependsOnId(stageId: string, dependsOnId: string | null): Promise<void> {
  await prisma.$executeRaw`UPDATE "Stage" SET "dependsOnId" = ${dependsOnId} WHERE id = ${stageId}`;
}

// Full list fetch. Uses Prisma for the known fields (correct date typing) and a raw
// query to backfill dependsOnId (not yet in the generated client).
async function listStages(projectId: string): Promise<Array<Record<string, unknown>>> {
  const [stages, depRows] = await Promise.all([
    prisma.stage.findMany({ where: { projectId }, orderBy: { order: "asc" } }),
    prisma.$queryRaw<Array<{ id: string; dependsOnId: string | null }>>`
      SELECT id, "dependsOnId" FROM "Stage" WHERE "projectId" = ${projectId}
    `,
  ]);
  const depMap = new Map(depRows.map((r) => [r.id, r.dependsOnId]));
  return stages.map((s) => ({ ...s, dependsOnId: depMap.get(s.id) ?? null }));
}

async function wouldCreateCycle(
  _projectId: string,
  stageId: string,
  dependsOnId: string
): Promise<boolean> {
  let currentId: string | null = dependsOnId;
  const visited = new Set<string>();
  while (currentId) {
    if (currentId === stageId) return true;
    if (visited.has(currentId)) break;
    visited.add(currentId);
    currentId = await getDependsOnId(currentId);
  }
  return false;
}

async function cascadeDependents(
  projectId: string,
  changedStageId: string,
  newEndDate: Date,
  visited = new Set<string>()
): Promise<void> {
  if (visited.has(changedStageId)) return;
  visited.add(changedStageId);

  // Find dependent IDs via raw SQL (dependsOnId isn't in Prisma's `where` types yet)
  const depIdRows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Stage"
    WHERE "projectId" = ${projectId} AND "dependsOnId" = ${changedStageId}
  `;
  if (depIdRows.length === 0) return;

  // Then load the full rows through Prisma so date fields are proper Date objects
  const dependents = await prisma.stage.findMany({
    where: { id: { in: depIdRows.map((r) => r.id) } },
  });

  for (const dep of dependents) {
    const durationMs =
      dep.startDate && dep.endDate
        ? dep.endDate.getTime() - dep.startDate.getTime()
        : (dep.durationWeeks ?? 1) * 7 * 24 * 60 * 60 * 1000;

    const newStart = new Date(newEndDate.getTime() + 24 * 60 * 60 * 1000);
    const newEnd = new Date(newStart.getTime() + durationMs);
    const newWeeks = Math.max(1, Math.round(durationMs / (7 * 24 * 60 * 60 * 1000)));

    await prisma.stage.update({
      where: { id: dep.id },
      data: { startDate: newStart, endDate: newEnd, durationWeeks: newWeeks },
    });

    await cascadeDependents(projectId, dep.id, newEnd, visited);
  }
}

// GET /projects/:projectId/stages
router.get("/", async (req: AuthRequest, res: Response) => {
  const projectId = req.params["projectId"] as string;
  const project = await getProjectWithAccess(projectId, req.user!.sub, req.user!.role);
  if (!project) {
    res.status(404).json({ code: "NOT_FOUND", message: "Project not found", hint: "" });
    return;
  }

  const stages = await listStages(projectId);
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

  const { title, description, startDate, endDate, durationWeeks, order, dependsOnId } = parsed.data;

  // Validate dependency
  let effectiveStartDate = startDate;
  if (dependsOnId) {
    const parent = await prisma.stage.findFirst({ where: { id: dependsOnId, projectId } });
    if (!parent) {
      res.status(400).json({ code: "INVALID_DEPENDENCY", message: "Dependency stage not found in this project", hint: "" });
      return;
    }
    if (parent.endDate) {
      effectiveStartDate = new Date(parent.endDate.getTime() + 24 * 60 * 60 * 1000).toISOString();
    }
  }

  const derived = deriveWeeksAndEnd({ startDate: effectiveStartDate, endDate, durationWeeks });

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
      startDate: effectiveStartDate ? new Date(effectiveStartDate) : null,
      endDate: derived.endDate ?? null,
      durationWeeks: derived.durationWeeks ?? null,
      order: nextOrder,
    },
  });

  // Write dependsOnId separately via raw SQL (Prisma client types not yet regenerated)
  if (dependsOnId) {
    await setDependsOnId(stage.id, dependsOnId);
  }

  // Return the row with dependsOnId included
  const persistedDep = await getDependsOnId(stage.id);
  res.status(201).json({ ...stage, dependsOnId: persistedDep });
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

  const stages = await listStages(projectId);
  res.json(stages);
});

// PUT /projects/:projectId/stages/:stageId
// Returns the full stages array (including cascaded updates to dependent stages)
router.put("/:stageId", async (req: AuthRequest, res: Response) => {
  const { projectId, stageId } = req.params as { projectId: string; stageId: string };
  const project = await getProjectWithAccess(projectId, req.user!.sub, req.user!.role);
  if (!project) {
    res.status(404).json({ code: "NOT_FOUND", message: "Project not found", hint: "" });
    return;
  }

  const existing = await prisma.stage.findFirst({ where: { id: stageId, projectId } });
  if (!existing) {
    res.status(404).json({ code: "NOT_FOUND", message: "Stage not found", hint: "" });
    return;
  }

  const parsed = stageSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: "VALIDATION_ERROR", message: "Invalid input", hint: parsed.error.flatten() });
    return;
  }

  const { title, description, color, startDate, endDate, durationWeeks, order, dependsOnId } = parsed.data;

  // Validate and resolve dependency
  let effectiveStartDate = startDate;
  let resolvedDependsOnId = dependsOnId; // undefined = not changing

  if (dependsOnId !== undefined) {
    if (dependsOnId !== null) {
      if (await wouldCreateCycle(projectId, stageId, dependsOnId)) {
        res.status(400).json({ code: "CYCLIC_DEPENDENCY", message: "Stage dependency would create a cycle", hint: "" });
        return;
      }
      const parent = await prisma.stage.findFirst({ where: { id: dependsOnId, projectId } });
      if (!parent) {
        res.status(400).json({ code: "INVALID_DEPENDENCY", message: "Dependency stage not found in this project", hint: "" });
        return;
      }
      if (parent.endDate) {
        effectiveStartDate = new Date(parent.endDate.getTime() + 24 * 60 * 60 * 1000).toISOString();
      }
    } else {
      resolvedDependsOnId = null;
    }
  }

  // Derivation: only fall back to existing endDate when NO date-related field is changing.
  // If any of (startDate, endDate, durationWeeks) is changing, we must recompute from the
  // incoming values — falling back to the old endDate would lock us into branch 1 of
  // deriveWeeksAndEnd (start+end → weeks), overriding the durationWeeks the client just sent.
  const startChanging = effectiveStartDate !== undefined;
  const endDateChanging = endDate !== undefined;
  const weeksChanging = durationWeeks !== undefined;
  const anyDateFieldChanging = startChanging || endDateChanging || weeksChanging;

  // Normalize existing date fields (raw SQL may return strings or Dates depending on driver)
  const existingStart = existing.startDate ? new Date(existing.startDate) : null;
  const existingEnd = existing.endDate ? new Date(existing.endDate) : null;

  // If weeks isn't changing, infer from existing (start, end) so duration is preserved
  // when only startDate moves (e.g. dependency just got wired up).
  const inferredWeeks =
    existing.durationWeeks ??
    (existingStart && existingEnd
      ? Math.max(1, Math.round((existingEnd.getTime() - existingStart.getTime()) / (7 * 24 * 60 * 60 * 1000)))
      : undefined);

  const derived = anyDateFieldChanging
    ? deriveWeeksAndEnd({
        startDate: startChanging ? effectiveStartDate : (existingStart?.toISOString() ?? null),
        endDate: endDateChanging ? endDate : null,
        durationWeeks: weeksChanging ? durationWeeks : inferredWeeks,
      })
    : {};

  const updated = await prisma.stage.update({
    where: { id: stageId },
    data: {
      ...(title !== undefined && { title }),
      ...(description !== undefined && { description: description ?? null }),
      ...(color !== undefined && { color }),
      ...(effectiveStartDate !== undefined && { startDate: effectiveStartDate ? new Date(effectiveStartDate) : null }),
      ...(derived.endDate !== undefined && { endDate: derived.endDate }),
      ...(derived.durationWeeks !== undefined && { durationWeeks: derived.durationWeeks }),
      ...(order !== undefined && { order }),
    },
  });

  // Persist dependsOnId via raw SQL (Prisma client types not yet regenerated)
  if (resolvedDependsOnId !== undefined) {
    await setDependsOnId(stageId, resolvedDependsOnId);
  }

  // Cascade to dependent stages if endDate changed
  const oldEndDate = existingEnd;
  const newEndDate = updated.endDate;
  if (newEndDate && (!oldEndDate || newEndDate.getTime() !== oldEndDate.getTime())) {
    await cascadeDependents(projectId, stageId, newEndDate);
  }

  // Return full stages list so client can update all cascaded changes at once
  const stages = await listStages(projectId);
  res.json(stages);
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
