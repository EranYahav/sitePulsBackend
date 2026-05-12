import { Router, Response } from "express";
import { z } from "zod";
import prisma from "../lib/prisma";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { getProjectWithAccess } from "./projects";
import { upload } from "../middleware/upload";
import { uploadStream, deleteAsset } from "../services/cloudinary";

const router = Router({ mergeParams: true });

router.use(requireAuth);

const createSchema = z.object({
  text: z.string().min(1).max(500),
  order: z.number().int().min(0).optional(),
});

const updateSchema = z.object({
  text: z.string().min(1).max(500).optional(),
  order: z.number().int().min(0).optional(),
  isRelevant: z.boolean().optional(),
  notes: z.string().max(2000).optional().nullable(),
});

const approvalSchema = z.object({
  notes: z.string().max(2000).optional().nullable(),
});

const reorderSchema = z.object({
  order: z.array(z.string().uuid()).min(1).max(200),
});

async function loadStageInProject(projectId: string, stageId: string) {
  return prisma.stage.findFirst({ where: { id: stageId, projectId } });
}

async function loadCheckInStage(stageId: string, checkId: string) {
  return prisma.check.findFirst({ where: { id: checkId, stageId } });
}

// GET /projects/:projectId/stages/:stageId/checks
router.get("/", async (req: AuthRequest, res: Response) => {
  const { projectId, stageId } = req.params as { projectId: string; stageId: string };

  const project = await getProjectWithAccess(projectId, req.user!.sub, req.user!.role);
  if (!project) {
    res.status(404).json({ code: "NOT_FOUND", message: "Project not found", hint: "" });
    return;
  }
  const stage = await loadStageInProject(projectId, stageId);
  if (!stage) {
    res.status(404).json({ code: "NOT_FOUND", message: "Stage not found", hint: "" });
    return;
  }

  const checks = await prisma.check.findMany({
    where: { stageId },
    orderBy: { order: "asc" },
  });
  res.json(checks);
});

// POST /projects/:projectId/stages/:stageId/checks — create custom (no templateId)
router.post("/", async (req: AuthRequest, res: Response) => {
  const { projectId, stageId } = req.params as { projectId: string; stageId: string };

  if (req.user!.role !== "supervisor") {
    res.status(403).json({ code: "FORBIDDEN", message: "Only supervisors can edit checks", hint: "" });
    return;
  }

  const project = await getProjectWithAccess(projectId, req.user!.sub, req.user!.role);
  if (!project) {
    res.status(404).json({ code: "NOT_FOUND", message: "Project not found", hint: "" });
    return;
  }
  const stage = await loadStageInProject(projectId, stageId);
  if (!stage) {
    res.status(404).json({ code: "NOT_FOUND", message: "Stage not found", hint: "" });
    return;
  }

  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: "VALIDATION_ERROR", message: "Invalid input", hint: parsed.error.flatten() });
    return;
  }

  const max = await prisma.check.aggregate({ where: { stageId }, _max: { order: true } });
  const order = parsed.data.order ?? ((max._max.order ?? -1) + 1);

  const check = await prisma.check.create({
    data: { stageId, text: parsed.data.text, order },
  });
  res.status(201).json(check);
});

// PUT /projects/:projectId/stages/:stageId/checks/reorder
// Body: { order: [checkId, checkId, ...] }
// All ids must belong to this stage. Sets each row's `order` to its index in the array.
router.put("/reorder", async (req: AuthRequest, res: Response) => {
  const { projectId, stageId } = req.params as { projectId: string; stageId: string };

  if (req.user!.role !== "supervisor") {
    res.status(403).json({ code: "FORBIDDEN", message: "Only supervisors can reorder checks", hint: "" });
    return;
  }

  const project = await getProjectWithAccess(projectId, req.user!.sub, req.user!.role);
  if (!project) {
    res.status(404).json({ code: "NOT_FOUND", message: "Project not found", hint: "" });
    return;
  }
  const stage = await loadStageInProject(projectId, stageId);
  if (!stage) {
    res.status(404).json({ code: "NOT_FOUND", message: "Stage not found", hint: "" });
    return;
  }

  const parsed = reorderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: "VALIDATION_ERROR", message: "Invalid input", hint: parsed.error.flatten() });
    return;
  }

  // Make sure every id in the payload belongs to this stage. We don't require the
  // payload to cover ALL checks — partial reorders are fine — but any unknown id is rejected.
  const existing = await prisma.check.findMany({ where: { stageId }, select: { id: true } });
  const known = new Set(existing.map((c) => c.id));
  const unknown = parsed.data.order.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    res.status(400).json({
      code: "UNKNOWN_CHECK",
      message: "One or more check ids do not belong to this stage",
      hint: { unknown },
    });
    return;
  }

  await prisma.$transaction(
    parsed.data.order.map((id, idx) =>
      prisma.check.update({ where: { id }, data: { order: idx } }),
    ),
  );

  const fresh = await prisma.check.findMany({ where: { stageId }, orderBy: { order: "asc" } });
  res.json(fresh);
});

// PATCH /projects/:projectId/stages/:stageId/checks/:checkId — edit fields
router.patch("/:checkId", async (req: AuthRequest, res: Response) => {
  const { projectId, stageId, checkId } = req.params as {
    projectId: string;
    stageId: string;
    checkId: string;
  };

  if (req.user!.role !== "supervisor") {
    res.status(403).json({ code: "FORBIDDEN", message: "Only supervisors can edit checks", hint: "" });
    return;
  }

  const project = await getProjectWithAccess(projectId, req.user!.sub, req.user!.role);
  if (!project) {
    res.status(404).json({ code: "NOT_FOUND", message: "Project not found", hint: "" });
    return;
  }
  const check = await loadCheckInStage(stageId, checkId);
  if (!check) {
    res.status(404).json({ code: "NOT_FOUND", message: "Check not found", hint: "" });
    return;
  }

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: "VALIDATION_ERROR", message: "Invalid input", hint: parsed.error.flatten() });
    return;
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.text !== undefined) data.text = parsed.data.text;
  if (parsed.data.order !== undefined) data.order = parsed.data.order;
  if (parsed.data.isRelevant !== undefined) data.isRelevant = parsed.data.isRelevant;
  if (parsed.data.notes !== undefined) data.notes = parsed.data.notes ?? null;

  const updated = await prisma.check.update({ where: { id: checkId }, data });
  res.json(updated);
});

// POST .../checks/:checkId/approve
router.post("/:checkId/approve", async (req: AuthRequest, res: Response) => {
  const { projectId, stageId, checkId } = req.params as {
    projectId: string;
    stageId: string;
    checkId: string;
  };

  if (req.user!.role !== "supervisor") {
    res.status(403).json({ code: "FORBIDDEN", message: "Only supervisors can approve", hint: "" });
    return;
  }

  const project = await getProjectWithAccess(projectId, req.user!.sub, req.user!.role);
  if (!project) {
    res.status(404).json({ code: "NOT_FOUND", message: "Project not found", hint: "" });
    return;
  }
  const check = await loadCheckInStage(stageId, checkId);
  if (!check) {
    res.status(404).json({ code: "NOT_FOUND", message: "Check not found", hint: "" });
    return;
  }

  const parsed = approvalSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ code: "VALIDATION_ERROR", message: "Invalid input", hint: parsed.error.flatten() });
    return;
  }

  const updated = await prisma.check.update({
    where: { id: checkId },
    data: {
      status: "approved",
      approvedAt: new Date(),
      approvedById: req.user!.sub,
      ...(parsed.data.notes !== undefined && { notes: parsed.data.notes ?? null }),
    },
  });
  res.json(updated);
});

// POST .../checks/:checkId/fail — flips status and auto-creates a Defect.
router.post("/:checkId/fail", async (req: AuthRequest, res: Response) => {
  const { projectId, stageId, checkId } = req.params as {
    projectId: string;
    stageId: string;
    checkId: string;
  };

  if (req.user!.role !== "supervisor") {
    res.status(403).json({ code: "FORBIDDEN", message: "Only supervisors can record failures", hint: "" });
    return;
  }

  const project = await getProjectWithAccess(projectId, req.user!.sub, req.user!.role);
  if (!project) {
    res.status(404).json({ code: "NOT_FOUND", message: "Project not found", hint: "" });
    return;
  }
  const check = await loadCheckInStage(stageId, checkId);
  if (!check) {
    res.status(404).json({ code: "NOT_FOUND", message: "Check not found", hint: "" });
    return;
  }

  const parsed = approvalSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ code: "VALIDATION_ERROR", message: "Invalid input", hint: parsed.error.flatten() });
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    let defectId = check.defectId;

    // Don't double-create the defect — if the check already had one (e.g. failed before), reuse it.
    if (!defectId) {
      const defect = await tx.defect.create({
        data: {
          projectId,
          stageId,
          title: check.text.slice(0, 200),
          description: parsed.data.notes ?? null,
          photoUrl: check.photoUrl ?? "",
          cloudinaryId: check.cloudinaryId ?? "",
          urgency: "medium",
          domain: "other",
          status: "open",
        },
      });
      defectId = defect.id;
    }

    const updated = await tx.check.update({
      where: { id: checkId },
      data: {
        status: "failed",
        approvedAt: new Date(),
        approvedById: req.user!.sub,
        defectId,
        ...(parsed.data.notes !== undefined && { notes: parsed.data.notes ?? null }),
      },
    });
    return updated;
  });

  res.json(result);
});

// POST .../checks/:checkId/photo — multipart upload
router.post(
  "/:checkId/photo",
  upload.single("file"),
  async (req: AuthRequest, res: Response) => {
    const { projectId, stageId, checkId } = req.params as {
      projectId: string;
      stageId: string;
      checkId: string;
    };

    if (req.user!.role !== "supervisor") {
      res.status(403).json({ code: "FORBIDDEN", message: "Only supervisors can attach photos", hint: "" });
      return;
    }

    const project = await getProjectWithAccess(projectId, req.user!.sub, req.user!.role);
    if (!project) {
      res.status(404).json({ code: "NOT_FOUND", message: "Project not found", hint: "" });
      return;
    }
    const check = await loadCheckInStage(stageId, checkId);
    if (!check) {
      res.status(404).json({ code: "NOT_FOUND", message: "Check not found", hint: "" });
      return;
    }

    if (!req.file) {
      res.status(400).json({ code: "VALIDATION_ERROR", message: "file is required", hint: "Send multipart 'file' field" });
      return;
    }

    const result = await uploadStream(req.file.buffer, "image", "onePulse/check");

    // Best-effort delete of the previous photo. Failure here shouldn't block the upload.
    if (check.cloudinaryId) {
      try {
        await deleteAsset(check.cloudinaryId, "image");
      } catch (e) {
        console.warn("deleteAsset failed for previous check photo", e);
      }
    }

    const updated = await prisma.check.update({
      where: { id: checkId },
      data: { photoUrl: result.url, cloudinaryId: result.publicId },
    });
    res.json(updated);
  },
);

// DELETE .../checks/:checkId — only custom checks (no templateId) can be hard-deleted.
router.delete("/:checkId", async (req: AuthRequest, res: Response) => {
  const { projectId, stageId, checkId } = req.params as {
    projectId: string;
    stageId: string;
    checkId: string;
  };

  if (req.user!.role !== "supervisor") {
    res.status(403).json({ code: "FORBIDDEN", message: "Only supervisors can delete checks", hint: "" });
    return;
  }

  const project = await getProjectWithAccess(projectId, req.user!.sub, req.user!.role);
  if (!project) {
    res.status(404).json({ code: "NOT_FOUND", message: "Project not found", hint: "" });
    return;
  }
  const check = await loadCheckInStage(stageId, checkId);
  if (!check) {
    res.status(404).json({ code: "NOT_FOUND", message: "Check not found", hint: "" });
    return;
  }

  if (check.templateId) {
    res.status(400).json({
      code: "TEMPLATE_CHECK",
      message: "Template-derived checks can only be marked as not relevant, not deleted",
      hint: "PATCH with { isRelevant: false } instead",
    });
    return;
  }

  if (check.cloudinaryId) {
    try { await deleteAsset(check.cloudinaryId, "image"); } catch { /* best effort */ }
  }
  await prisma.check.delete({ where: { id: checkId } });
  res.status(204).send();
});

export default router;
