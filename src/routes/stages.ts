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

// GET /projects/:projectId/stages/available-templates
// Preset stages from the project's type that aren't in the project yet (matched by
// templateId) — so the inspector can add pre-defined stages retroactively.
router.get("/available-templates", async (req: AuthRequest, res: Response) => {
  const projectId = req.params["projectId"] as string;
  const project = await getProjectWithAccess(projectId, req.user!.sub, req.user!.role);
  if (!project) {
    res.status(404).json({ code: "NOT_FOUND", message: "Project not found", hint: "" });
    return;
  }
  if (!project.projectTypeId) {
    res.json([]);
    return;
  }
  const type = await prisma.projectType.findUnique({
    where: { id: project.projectTypeId },
    include: {
      stageTemplates: {
        orderBy: { order: "asc" },
        include: { _count: { select: { checkTemplates: true } } },
      },
    },
  });
  if (!type) {
    res.json([]);
    return;
  }
  const existing = await prisma.stage.findMany({
    where: { projectId, templateId: { not: null } },
    select: { templateId: true },
  });
  const have = new Set(existing.map((s) => s.templateId));
  const available = type.stageTemplates
    .filter((st) => !have.has(st.id))
    .map((st) => ({
      templateId: st.id,
      title: st.title,
      description: st.description,
      defaultDurationWeeks: st.defaultDurationWeeks,
      order: st.order,
      checkCount: st._count.checkTemplates,
    }));
  res.json(available);
});

// POST /projects/:projectId/stages/from-templates  body { templateIds: string[] }
// Add selected preset stages (with their check templates) to the project. Skips any
// already present; respects the MAX_STAGES cap.
router.post("/from-templates", async (req: AuthRequest, res: Response) => {
  const projectId = req.params["projectId"] as string;
  const project = await getProjectWithAccess(projectId, req.user!.sub, req.user!.role);
  if (!project) {
    res.status(404).json({ code: "NOT_FOUND", message: "Project not found", hint: "" });
    return;
  }
  if (!project.projectTypeId) {
    res.status(400).json({ code: "NO_PROJECT_TYPE", message: "Project has no type", hint: "" });
    return;
  }
  const parsed = z.object({ templateIds: z.array(z.string().uuid()).min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: "VALIDATION_ERROR", message: "templateIds required", hint: parsed.error.flatten() });
    return;
  }

  const type = await prisma.projectType.findUnique({
    where: { id: project.projectTypeId },
    include: {
      stageTemplates: {
        where: { id: { in: parsed.data.templateIds } },
        orderBy: { order: "asc" },
        include: { checkTemplates: { orderBy: { order: "asc" } } },
      },
    },
  });
  if (!type) {
    res.status(404).json({ code: "NOT_FOUND", message: "Project type not found", hint: "" });
    return;
  }

  const existing = await prisma.stage.findMany({
    where: { projectId, templateId: { not: null } },
    select: { templateId: true },
  });
  const have = new Set(existing.map((s) => s.templateId));

  const usedColors = new Set(
    (await prisma.stage.findMany({ where: { projectId }, select: { color: true } })).map((s) => s.color),
  );
  const startCount = await prisma.stage.count({ where: { projectId } });
  const maxOrderRow = await prisma.stage.aggregate({ where: { projectId }, _max: { order: true } });
  let order = (maxOrderRow._max.order ?? -1) + 1;
  let count = startCount;

  await prisma.$transaction(async (tx) => {
    for (const st of type.stageTemplates) {
      if (have.has(st.id) || count >= MAX_STAGES) continue;
      const color = STAGE_COLORS.find((c) => !usedColors.has(c)) ?? STAGE_COLORS[order % STAGE_COLORS.length]!;
      usedColors.add(color);
      const created = await tx.stage.create({
        data: {
          projectId,
          templateId: st.id,
          title: st.title,
          description: st.description,
          color,
          durationWeeks: st.defaultDurationWeeks,
          order: order++,
        },
      });
      count++;
      for (let j = 0; j < st.checkTemplates.length; j++) {
        const ct = st.checkTemplates[j]!;
        await tx.check.create({ data: { stageId: created.id, templateId: ct.id, text: ct.text, order: j } });
      }
    }
  });

  const stages = await listStages(projectId);
  res.json(stages);
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

// GET /projects/:projectId/stages/:stageId/delete-impact
// What deleting this stage will affect: its checks are cascade-DELETED (incl. documented
// ones), while reports & defects are unlinked (stageId → null). Surfaced so the confirm
// dialog is never a silent data-loss surprise.
router.get("/:stageId/delete-impact", async (req: AuthRequest, res: Response) => {
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
  const [checksAll, reports, defects] = await Promise.all([
    prisma.check.findMany({ where: { stageId }, select: { status: true, photoUrl: true } }),
    prisma.report.count({ where: { stageId } }),
    prisma.defect.count({ where: { stageId } }),
  ]);
  // "Documented" = carries recorded evidence we'd be destroying (approved/failed or a photo).
  const documentedChecks = checksAll.filter((c) => c.status !== "pending" || c.photoUrl).length;
  res.json({ checks: checksAll.length, documentedChecks, reports, defects });
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

  // Dependency repair: stages that depend on the one being deleted get re-pointed to
  // ITS predecessor (the stage it depended on), so the chain isn't broken. Then their
  // dates are recomputed from the new parent and cascaded forward. If the deleted stage
  // had no predecessor, dependents are left unlinked (dates kept) for the user to adjust.
  const predecessorId = await getDependsOnId(stageId);
  const dependentRows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Stage" WHERE "projectId" = ${projectId} AND "dependsOnId" = ${stageId}
  `;
  const predecessor = predecessorId
    ? await prisma.stage.findFirst({ where: { id: predecessorId, projectId } })
    : null;

  await prisma.stage.delete({ where: { id: stageId } });

  for (const { id: depId } of dependentRows) {
    await setDependsOnId(depId, predecessorId); // re-link to predecessor (or null)
    if (predecessor?.endDate) {
      const dep = await prisma.stage.findFirst({ where: { id: depId } });
      if (dep) {
        const durWeeks =
          dep.durationWeeks ??
          (dep.startDate && dep.endDate
            ? Math.max(1, Math.round((dep.endDate.getTime() - dep.startDate.getTime()) / (7 * 24 * 60 * 60 * 1000)))
            : 1);
        const newStart = new Date(predecessor.endDate.getTime() + 24 * 60 * 60 * 1000);
        const derived = deriveWeeksAndEnd({ startDate: newStart.toISOString(), durationWeeks: durWeeks });
        await prisma.stage.update({
          where: { id: depId },
          data: { startDate: newStart, endDate: derived.endDate ?? null, durationWeeks: derived.durationWeeks ?? durWeeks },
        });
        if (derived.endDate) await cascadeDependents(projectId, depId, derived.endDate);
      }
    }
  }

  // Return the full updated list so the client reflects re-linked dependents + new dates.
  const stages = await listStages(projectId);
  res.json(stages);
});

// POST /projects/:projectId/stages/:stageId/complete — mark a stage complete / reopen.
// Marking complete is the milestone EVENT. Reopening also unpublishes (a milestone the
// client saw as done shouldn't linger published once it's reopened — T3 covers richer
// revert semantics later).
router.post("/:stageId/complete", async (req: AuthRequest, res: Response) => {
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
  const completed = (req.body as { completed?: boolean }).completed !== false;
  const updated = await prisma.stage.update({
    where: { id: stageId },
    data: completed
      ? { completedAt: stage.completedAt ?? new Date() } // idempotent: don't reset the date on re-complete
      : { completedAt: null, clientPublished: false },
  });
  res.json(updated);
});

// POST /projects/:projectId/stages/:stageId/publish — publish/unpublish the milestone.
// Inspector controls WHEN the client sees it. Cannot publish a stage that isn't complete.
router.post("/:stageId/publish", async (req: AuthRequest, res: Response) => {
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
  const published = (req.body as { published?: boolean }).published === true;
  if (published && !stage.completedAt) {
    res.status(400).json({ code: "NOT_COMPLETE", message: "Cannot publish a milestone that isn't marked complete", hint: "Mark the stage complete first" });
    return;
  }
  const updated = await prisma.stage.update({ where: { id: stageId }, data: { clientPublished: published } });
  res.json(updated);
});

export default router;
