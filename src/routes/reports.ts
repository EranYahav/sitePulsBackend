import { Router, Response } from "express";
import { z } from "zod";
import prisma from "../lib/prisma";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { getProjectWithAccess } from "./projects";
import { generateAIReport } from "../services/ai";
import { upload } from "../middleware/upload";
import { uploadStream, deleteAsset } from "../services/cloudinary";

const router = Router({ mergeParams: true });

const createSchema = z.object({
  notes: z.string().min(1, "Notes cannot be empty"),
  lang: z.enum(["en", "he", "ru", "ar"]).default("en"),
});


router.use(requireAuth);

// GET /projects/:projectId/reports
router.get("/", async (req: AuthRequest, res: Response) => {
  const { projectId } = req.params as { projectId: string };
  const project = await getProjectWithAccess(projectId, req.user!.sub, req.user!.role);
  if (!project) {
    res.status(404).json({ code: "NOT_FOUND", message: "Project not found", hint: "" });
    return;
  }
  const reports = await prisma.report.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, notes: true, createdAt: true, title: true, reportData: true },
  });
  res.json(reports);
});

// POST /projects/:projectId/reports
router.post("/", async (req: AuthRequest, res: Response) => {
  const { projectId } = req.params as { projectId: string };

  if (req.user!.role !== "supervisor") {
    res.status(403).json({ code: "FORBIDDEN", message: "Only supervisors can submit reports", hint: "" });
    return;
  }

  const project = await getProjectWithAccess(projectId, req.user!.sub, req.user!.role);
  if (!project) {
    res.status(404).json({ code: "NOT_FOUND", message: "Project not found", hint: "" });
    return;
  }

  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: "VALIDATION_ERROR", message: "Notes are required", hint: parsed.error.flatten() });
    return;
  }

  const report = await prisma.report.create({
    data: { projectId, authorId: req.user!.sub, notes: parsed.data.notes, status: "pending" },
  });

  // Kick off async AI generation (non-blocking)
  generateReport(report.id, parsed.data.notes, project.name, parsed.data.lang).catch(console.error);

  res.status(201).json(report);
});

// PATCH /projects/:projectId/reports/:reportId — update notes and re-run AI
router.patch("/:reportId", async (req: AuthRequest, res: Response) => {
  const { projectId, reportId } = req.params as { projectId: string; reportId: string };

  const report = await prisma.report.findUnique({
    where: { id: reportId },
    include: { project: { select: { name: true } } },
  });
  if (!report || report.projectId !== projectId) {
    res.status(404).json({ code: "NOT_FOUND", message: "Report not found", hint: "" });
    return;
  }
  if (report.authorId !== req.user!.sub) {
    res.status(403).json({ code: "FORBIDDEN", message: "Only the author can edit this report", hint: "" });
    return;
  }

  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: "VALIDATION_ERROR", message: "Notes are required", hint: parsed.error.flatten() });
    return;
  }

  const updated = await prisma.report.update({
    where: { id: reportId },
    data: { notes: parsed.data.notes, status: "pending", reportData: null },
  });

  generateReport(reportId, parsed.data.notes, report.project.name, parsed.data.lang).catch(console.error);

  res.json(updated);
});

// PATCH /projects/:projectId/reports/:reportId/data — update individual fields without AI re-run
router.patch("/:reportId/data", async (req: AuthRequest, res: Response) => {
  const { projectId, reportId } = req.params as { projectId: string; reportId: string };

  const report = await prisma.report.findUnique({ where: { id: reportId } });
  if (!report || report.projectId !== projectId) {
    res.status(404).json({ code: "NOT_FOUND", message: "Report not found", hint: "" });
    return;
  }
  if (report.authorId !== req.user!.sub) {
    res.status(403).json({ code: "FORBIDDEN", message: "Only the author can edit this report", hint: "" });
    return;
  }

  const existing = report.reportData ? JSON.parse(report.reportData) : {};
  const merged = { ...existing, ...req.body };

  const updatePayload: Record<string, unknown> = { reportData: JSON.stringify(merged) };
  if (typeof req.body.title === "string") updatePayload.title = req.body.title;

  const updated = await prisma.report.update({ where: { id: reportId }, data: updatePayload });
  res.json(updated);
});

// DELETE /projects/:projectId/reports/:reportId
router.delete("/:reportId", async (req: AuthRequest, res: Response) => {
  const { projectId, reportId } = req.params as { projectId: string; reportId: string };

  const report = await prisma.report.findUnique({ where: { id: reportId } });
  if (!report || report.projectId !== projectId) {
    res.status(404).json({ code: "NOT_FOUND", message: "Report not found", hint: "" });
    return;
  }
  if (report.authorId !== req.user!.sub) {
    res.status(403).json({ code: "FORBIDDEN", message: "Only the author can delete this report", hint: "" });
    return;
  }

  await prisma.report.delete({ where: { id: reportId } });
  res.status(204).send();
});

// GET /reports/:id (top-level, registered in index.ts)
export async function getReport(req: AuthRequest, res: Response) {
  const { id } = req.params as { id: string };
  const report = await prisma.report.findUnique({
    where: { id },
    include: { project: { select: { ownerId: true, name: true } } },
  });
  if (!report) {
    res.status(404).json({ code: "NOT_FOUND", message: "Report not found", hint: "" });
    return;
  }

  const isOwner = report.authorId === req.user!.sub;
  const isManager = req.user!.role === "manager" && await prisma.projectManager.findUnique({
    where: { projectId_managerId: { projectId: report.projectId, managerId: req.user!.sub } },
  });

  if (!isOwner && !isManager) {
    res.status(403).json({ code: "FORBIDDEN", message: "Not authorised", hint: "" });
    return;
  }

  res.json(report);
}

async function generateReport(reportId: string, notes: string, projectName: string, lang = "en") {
  await prisma.report.update({ where: { id: reportId }, data: { status: "generating" } });
  try {
    const reportData = await generateAIReport(notes, projectName, lang);
    await prisma.report.update({
      where: { id: reportId },
      data: { status: "done", title: reportData.title, reportData: JSON.stringify(reportData) },
    });
  } catch (err) {
    await prisma.report.update({ where: { id: reportId }, data: { status: "failed" } });
    throw err;
  }
}

// POST /projects/:projectId/reports/:reportId/media — upload image or video
router.post(
  "/:reportId/media",
  upload.single("file"),
  async (req: AuthRequest, res: Response) => {
    const { projectId, reportId } = req.params as { projectId: string; reportId: string };

    const report = await prisma.report.findUnique({ where: { id: reportId } });
    if (!report || report.projectId !== projectId) {
      res.status(404).json({ code: "NOT_FOUND", message: "Report not found", hint: "" });
      return;
    }
    if (report.authorId !== req.user!.sub) {
      res.status(403).json({ code: "FORBIDDEN", message: "Only the author can upload media", hint: "" });
      return;
    }
    if (!req.file) {
      res.status(400).json({ code: "VALIDATION_ERROR", message: "No file provided", hint: "Send file as multipart/form-data field named 'file'" });
      return;
    }

    const isVideo = req.file.mimetype.startsWith("video/");
    const result = await uploadStream(req.file.buffer, isVideo ? "video" : "image");

    const media = await prisma.reportImage.create({
      data: { reportId, cloudinaryId: result.publicId, url: result.url },
    });

    res.status(201).json(media);
  },
);

// PUT /projects/:projectId/reports/:reportId/media/:mediaId — replace with annotated version
router.put(
  "/:reportId/media/:mediaId",
  upload.single("file"),
  async (req: AuthRequest, res: Response) => {
    const { projectId, reportId, mediaId } = req.params as {
      projectId: string;
      reportId: string;
      mediaId: string;
    };

    const report = await prisma.report.findUnique({ where: { id: reportId } });
    if (!report || report.projectId !== projectId) {
      res.status(404).json({ code: "NOT_FOUND", message: "Report not found", hint: "" });
      return;
    }
    if (report.authorId !== req.user!.sub) {
      res.status(403).json({ code: "FORBIDDEN", message: "Only the author can update media", hint: "" });
      return;
    }
    if (!req.file) {
      res.status(400).json({ code: "VALIDATION_ERROR", message: "No file provided", hint: "" });
      return;
    }

    const media = await prisma.reportImage.findUnique({ where: { id: mediaId } });
    if (!media || media.reportId !== reportId) {
      res.status(404).json({ code: "NOT_FOUND", message: "Media not found", hint: "" });
      return;
    }

    // Delete old asset from Cloudinary then upload the new annotated version
    await deleteAsset(media.cloudinaryId, "image");
    const result = await uploadStream(req.file.buffer, "image");

    const updated = await prisma.reportImage.update({
      where: { id: mediaId },
      data: { cloudinaryId: result.publicId, url: result.url },
    });

    res.json(updated);
  },
);

// DELETE /projects/:projectId/reports/:reportId/media/:mediaId
router.delete("/:reportId/media/:mediaId", async (req: AuthRequest, res: Response) => {
  const { projectId, reportId, mediaId } = req.params as {
    projectId: string;
    reportId: string;
    mediaId: string;
  };

  const report = await prisma.report.findUnique({ where: { id: reportId } });
  if (!report || report.projectId !== projectId) {
    res.status(404).json({ code: "NOT_FOUND", message: "Report not found", hint: "" });
    return;
  }
  if (report.authorId !== req.user!.sub) {
    res.status(403).json({ code: "FORBIDDEN", message: "Only the author can delete media", hint: "" });
    return;
  }

  const media = await prisma.reportImage.findUnique({ where: { id: mediaId } });
  if (!media || media.reportId !== reportId) {
    res.status(404).json({ code: "NOT_FOUND", message: "Media not found", hint: "" });
    return;
  }

  // Determine resource type from cloudinaryId prefix convention (images have no /video/ segment)
  const resourceType = media.cloudinaryId.includes("/video/") ? "video" : "image";
  await deleteAsset(media.cloudinaryId, resourceType);
  await prisma.reportImage.delete({ where: { id: mediaId } });

  res.status(204).send();
});

// GET /projects/:projectId/reports/:reportId/media
router.get("/:reportId/media", async (req: AuthRequest, res: Response) => {
  const { projectId, reportId } = req.params as { projectId: string; reportId: string };

  const report = await prisma.report.findUnique({ where: { id: reportId } });
  if (!report || report.projectId !== projectId) {
    res.status(404).json({ code: "NOT_FOUND", message: "Report not found", hint: "" });
    return;
  }

  const media = await prisma.reportImage.findMany({ where: { reportId } });
  res.json(media);
});

export default router;
