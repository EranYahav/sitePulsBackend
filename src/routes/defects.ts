import { Router, Response } from "express";
import { z } from "zod";
import prisma from "../lib/prisma";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { getProjectWithAccess } from "./projects";
import { upload } from "../middleware/upload";
import { uploadStream, deleteAsset } from "../services/cloudinary";
import { analyzeDefect } from "../services/ai";

const router = Router({ mergeParams: true });

const VALID_URGENCIES = ["high", "medium", "low"] as const;
const VALID_DOMAINS = ["electrical", "plumbing", "drywall", "tiling", "paint", "structure", "other"] as const;
const VALID_STATUSES = ["open", "assigned", "resolved"] as const;
const VALID_SORTS = ["urgency", "date", "tradesperson", "reminderDate"] as const;

const createSchema = z.object({
  title: z.string().min(1, "Title is required"),
  urgency: z.enum(VALID_URGENCIES),
  domain: z.enum(VALID_DOMAINS),
  description: z.string().optional(),
  tradesperson: z.string().optional(),
  reminderDate: z.string().datetime({ offset: true }).optional().nullable(),
  phaseId: z.string().optional().nullable(),
});

const statusSchema = z.object({
  status: z.enum(VALID_STATUSES).optional(),
  trackingNotes: z.string().optional(),
});

router.use(requireAuth);

// GET /projects/:projectId/defects?sort=urgency|date|tradesperson|reminderDate
router.get("/", async (req: AuthRequest, res: Response) => {
  const { projectId } = req.params as { projectId: string };
  const sort = (req.query.sort as string) ?? "urgency";

  const project = await getProjectWithAccess(projectId, req.user!.sub, req.user!.role);
  if (!project) {
    res.status(404).json({ code: "NOT_FOUND", message: "Project not found", hint: "" });
    return;
  }

  const urgencyOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };

  const defects = await prisma.defect.findMany({
    where: { projectId },
    orderBy: buildOrderBy(sort),
  });

  // Secondary sort by createdAt for non-date primary sorts
  if (sort === "urgency") {
    defects.sort((a, b) => {
      const uDiff = (urgencyOrder[a.urgency] ?? 9) - (urgencyOrder[b.urgency] ?? 9);
      if (uDiff !== 0) return uDiff;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
  }

  res.json(defects);
});

function buildOrderBy(sort: string) {
  switch (sort) {
    case "date":
      return { createdAt: "desc" as const };
    case "tradesperson":
      return { tradesperson: "asc" as const };
    case "reminderDate":
      return { reminderDate: "asc" as const };
    default:
      return { createdAt: "desc" as const };
  }
}

// POST /projects/:projectId/defects/analyze — AI extraction from free text
router.post("/analyze", async (req: AuthRequest, res: Response) => {
  const { projectId } = req.params as { projectId: string };

  if (req.user!.role !== "supervisor") {
    res.status(403).json({ code: "FORBIDDEN", message: "Only supervisors can log defects", hint: "" });
    return;
  }

  const project = await getProjectWithAccess(projectId, req.user!.sub, req.user!.role);
  if (!project) {
    res.status(404).json({ code: "NOT_FOUND", message: "Project not found", hint: "" });
    return;
  }

  const { text, lang } = req.body as { text?: string; lang?: string };
  if (!text?.trim()) {
    res.status(400).json({ code: "VALIDATION_ERROR", message: "text is required", hint: "" });
    return;
  }

  const result = await analyzeDefect(text.trim(), lang ?? "he");
  res.json(result);
});

// POST /projects/:projectId/defects (multipart: file + JSON fields)
router.post(
  "/",
  upload.single("file"),
  async (req: AuthRequest, res: Response) => {
    const { projectId } = req.params as { projectId: string };

    if (req.user!.role !== "supervisor") {
      res.status(403).json({ code: "FORBIDDEN", message: "Only supervisors can log defects", hint: "" });
      return;
    }

    const project = await getProjectWithAccess(projectId, req.user!.sub, req.user!.role);
    if (!project) {
      res.status(404).json({ code: "NOT_FOUND", message: "Project not found", hint: "" });
      return;
    }

    const body = {
      title: req.body.title,
      urgency: req.body.urgency,
      domain: req.body.domain,
      description: req.body.description || undefined,
      tradesperson: req.body.tradesperson || undefined,
      reminderDate: req.body.reminderDate || undefined,
      phaseId: req.body.phaseId || undefined,
    };

    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      res.status(400).json({ code: "VALIDATION_ERROR", message: "Invalid fields", hint: parsed.error.flatten() });
      return;
    }

    let photoUrl = '';
    let cloudinaryId = '';
    if (req.file) {
      const result = await uploadStream(req.file.buffer, "image", "onePulse/defect");
      photoUrl = result.url;
      cloudinaryId = result.publicId;
    }

    const defect = await prisma.defect.create({
      data: {
        projectId,
        phaseId: parsed.data.phaseId ?? null,
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        photoUrl,
        cloudinaryId,
        urgency: parsed.data.urgency,
        domain: parsed.data.domain,
        tradesperson: parsed.data.tradesperson ?? null,
        reminderDate: parsed.data.reminderDate ? new Date(parsed.data.reminderDate) : null,
        status: "open",
      },
    });

    res.status(201).json(defect);
  },
);

// GET /projects/:projectId/defects/:defectId
router.get("/:defectId", async (req: AuthRequest, res: Response) => {
  const { projectId, defectId } = req.params as { projectId: string; defectId: string };

  const project = await getProjectWithAccess(projectId, req.user!.sub, req.user!.role);
  if (!project) {
    res.status(404).json({ code: "NOT_FOUND", message: "Project not found", hint: "" });
    return;
  }

  const defect = await prisma.defect.findUnique({ where: { id: defectId } });
  if (!defect || defect.projectId !== projectId) {
    res.status(404).json({ code: "NOT_FOUND", message: "Defect not found", hint: "" });
    return;
  }

  res.json(defect);
});

// PATCH /projects/:projectId/defects/:defectId — update status only
router.patch("/:defectId", async (req: AuthRequest, res: Response) => {
  const { projectId, defectId } = req.params as { projectId: string; defectId: string };

  if (req.user!.role !== "supervisor") {
    res.status(403).json({ code: "FORBIDDEN", message: "Only supervisors can update defects", hint: "" });
    return;
  }

  const defect = await prisma.defect.findUnique({ where: { id: defectId } });
  if (!defect || defect.projectId !== projectId) {
    res.status(404).json({ code: "NOT_FOUND", message: "Defect not found", hint: "" });
    return;
  }

  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: "VALIDATION_ERROR", message: "Invalid status", hint: parsed.error.flatten() });
    return;
  }

  const updated = await prisma.defect.update({
    where: { id: defectId },
    data: {
      ...(parsed.data.status !== undefined && { status: parsed.data.status }),
      ...(parsed.data.trackingNotes !== undefined && { trackingNotes: parsed.data.trackingNotes || null }),
    },
  });

  res.json(updated);
});

// PUT /projects/:projectId/defects/:defectId — edit all fields (optional photo replacement)
router.put(
  "/:defectId",
  upload.single("file"),
  async (req: AuthRequest, res: Response) => {
    const { projectId, defectId } = req.params as { projectId: string; defectId: string };

    if (req.user!.role !== "supervisor") {
      res.status(403).json({ code: "FORBIDDEN", message: "Only supervisors can edit defects", hint: "" });
      return;
    }

    const defect = await prisma.defect.findUnique({ where: { id: defectId } });
    if (!defect || defect.projectId !== projectId) {
      res.status(404).json({ code: "NOT_FOUND", message: "Defect not found", hint: "" });
      return;
    }

    const body = {
      title: req.body.title,
      urgency: req.body.urgency,
      domain: req.body.domain,
      description: req.body.description || undefined,
      tradesperson: req.body.tradesperson || undefined,
      reminderDate: req.body.reminderDate || undefined,
    };

    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      res.status(400).json({ code: "VALIDATION_ERROR", message: "Invalid fields", hint: parsed.error.flatten() });
      return;
    }

    let photoUrl = defect.photoUrl;
    let cloudinaryId = defect.cloudinaryId;

    if (req.file) {
      const result = await uploadStream(req.file.buffer, "image", "onePulse/defect");
      await deleteAsset(defect.cloudinaryId, "image");
      photoUrl = result.url;
      cloudinaryId = result.publicId;
    }

    const updated = await prisma.defect.update({
      where: { id: defectId },
      data: {
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        urgency: parsed.data.urgency,
        domain: parsed.data.domain,
        tradesperson: parsed.data.tradesperson ?? null,
        reminderDate: parsed.data.reminderDate ? new Date(parsed.data.reminderDate) : null,
        photoUrl,
        cloudinaryId,
        ...(req.body.trackingNotes !== undefined && {
          trackingNotes: req.body.trackingNotes || null,
        }),
      },
    });

    res.json(updated);
  },
);

// DELETE /projects/:projectId/defects/:defectId
router.delete("/:defectId", async (req: AuthRequest, res: Response) => {
  const { projectId, defectId } = req.params as { projectId: string; defectId: string };

  if (req.user!.role !== "supervisor") {
    res.status(403).json({ code: "FORBIDDEN", message: "Only supervisors can delete defects", hint: "" });
    return;
  }

  const defect = await prisma.defect.findUnique({ where: { id: defectId } });
  if (!defect || defect.projectId !== projectId) {
    res.status(404).json({ code: "NOT_FOUND", message: "Defect not found", hint: "" });
    return;
  }

  if (defect.cloudinaryId) await deleteAsset(defect.cloudinaryId, "image");
  await prisma.defect.delete({ where: { id: defectId } });

  res.status(204).send();
});

export default router;
