import { Router, Response, NextFunction } from "express";
import multer from "multer";
import { z } from "zod";
import prisma from "../lib/prisma";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { getProjectWithAccess } from "./projects";
import { upload } from "../middleware/upload";
import { uploadStream, deleteAsset, deleteByPrefix } from "../services/cloudinary";
import { inferStageId, activeStages } from "../lib/stageInference";

const router = Router({ mergeParams: true });
router.use(requireAuth);

// ─── Default locations per project type (E1 — kills the cold start) ──────────
// Mirrors the StageTemplate seeding idea: a starter, editable room/area list.
// Keyed by ProjectType.key. kind: "room" (interior) | "area" (building-level).
const DEFAULT_LOCATIONS: Record<string, Array<{ name: string; kind: "room" | "area" }>> = {
  private_house: [
    { name: "סלון", kind: "room" }, { name: "מטבח", kind: "room" },
    { name: "פינת אוכל", kind: "room" }, { name: "חדר רחצה", kind: "room" },
    { name: "חדר רחצה הורים", kind: "room" }, { name: "חדר שינה הורים", kind: "room" },
    { name: "חדר שינה", kind: "room" }, { name: 'ממ"ד', kind: "room" },
    { name: "מרפסת", kind: "room" },
    { name: "יסודות", kind: "area" }, { name: "שלד", kind: "area" },
    { name: "גג", kind: "area" }, { name: "חזית", kind: "area" },
    { name: "חצר", kind: "area" }, { name: "חניה", kind: "area" },
  ],
  apartment_in_building: [
    { name: "סלון", kind: "room" }, { name: "מטבח", kind: "room" },
    { name: "חדר רחצה", kind: "room" }, { name: "חדר רחצה הורים", kind: "room" },
    { name: "חדר שינה הורים", kind: "room" }, { name: "חדר שינה", kind: "room" },
    { name: 'ממ"ד', kind: "room" }, { name: "מרפסת", kind: "room" },
    { name: "כניסה", kind: "area" }, { name: "מרפסת שירות", kind: "area" },
  ],
  renovation: [
    { name: "סלון", kind: "room" }, { name: "מטבח", kind: "room" },
    { name: "חדר רחצה", kind: "room" }, { name: "חדר שינה", kind: "room" },
    { name: "כללי", kind: "area" },
  ],
  commercial: [
    { name: "כניסה", kind: "area" }, { name: "אזור מכירה / קבלה", kind: "room" },
    { name: "משרד", kind: "room" }, { name: "מטבחון", kind: "room" },
    { name: "שירותים", kind: "room" }, { name: "חזית", kind: "area" },
    { name: "מחסן", kind: "area" },
  ],
};

// ─── Access helpers ──────────────────────────────────────────────────────────

// View access: owning supervisor OR assigned manager. Returns the project or null
// (after sending 404). Use for all GET routes.
async function loadViewableProject(req: AuthRequest, res: Response) {
  const { projectId } = req.params as { projectId: string };
  const project = await getProjectWithAccess(projectId, req.user!.sub, req.user!.role);
  if (!project) {
    res.status(404).json({ code: "NOT_FOUND", message: "Project not found", hint: "" });
    return null;
  }
  return project;
}

// Write access: owning supervisor ONLY (managers are read-only across the app).
// Returns the project or null (after sending 403/404). Use for all mutations.
async function loadOwnedProject(req: AuthRequest, res: Response) {
  if (req.user!.role !== "supervisor") {
    res.status(403).json({ code: "FORBIDDEN", message: "Only the project owner can change media", hint: "" });
    return null;
  }
  const { projectId } = req.params as { projectId: string };
  const project = await prisma.project.findFirst({ where: { id: projectId, ownerId: req.user!.sub } });
  if (!project) {
    res.status(404).json({ code: "NOT_FOUND", message: "Project not found", hint: "" });
    return null;
  }
  return project;
}

// IDOR guards — a foreign-but-valid id must be rejected; Prisma connect won't do this.
async function locationBelongs(locationId: string, projectId: string): Promise<boolean> {
  const loc = await prisma.location.findFirst({ where: { id: locationId, projectId } });
  return !!loc;
}
async function stageBelongs(stageId: string, projectId: string): Promise<boolean> {
  const stage = await prisma.stage.findFirst({ where: { id: stageId, projectId } });
  return !!stage;
}

const MEDIA_INCLUDE = {
  stage: { select: { id: true, title: true, color: true } },
  location: { select: { id: true, name: true, kind: true } },
  uploadedBy: { select: { id: true, name: true } },
} as const;

// ─── Locations ────────────────────────────────────────────────────────────────

// GET locations + media count + cover (latest media url) — the by-location browse index.
router.get("/locations", async (req: AuthRequest, res: Response) => {
  const project = await loadViewableProject(req, res);
  if (!project) return;

  const locations = await prisma.location.findMany({
    where: { projectId: project.id },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
    include: { _count: { select: { media: true } } },
  });

  // Cover = most recent media per location (one extra query, not per-row N+1).
  const covers = await prisma.media.findMany({
    where: { projectId: project.id, locationId: { not: null } },
    orderBy: { capturedAt: "desc" },
    select: { locationId: true, url: true, type: true },
  });
  const coverByLoc = new Map<string, { url: string; type: string }>();
  for (const m of covers) {
    if (m.locationId && !coverByLoc.has(m.locationId)) coverByLoc.set(m.locationId, { url: m.url, type: m.type });
  }

  res.json(
    locations.map((l) => ({
      id: l.id, name: l.name, kind: l.kind,
      mediaCount: l._count.media,
      cover: coverByLoc.get(l.id) ?? null,
    })),
  );
});

// GET the project type's default locations that are NOT already present (for the seed button).
router.get("/locations/default-suggestions", async (req: AuthRequest, res: Response) => {
  const project = await loadViewableProject(req, res);
  if (!project) return;
  if (!project.projectTypeId) { res.json([]); return; }

  const type = await prisma.projectType.findUnique({ where: { id: project.projectTypeId } });
  const defaults = (type && DEFAULT_LOCATIONS[type.key]) || [];
  const existing = new Set((await prisma.location.findMany({
    where: { projectId: project.id }, select: { name: true },
  })).map((l) => l.name));

  res.json(defaults.filter((d) => !existing.has(d.name)));
});

// POST seed the project type's default locations (owner only). Idempotent on name.
router.post("/locations/seed-defaults", async (req: AuthRequest, res: Response) => {
  const project = await loadOwnedProject(req, res);
  if (!project) return;
  if (!project.projectTypeId) { res.json([]); return; }

  const type = await prisma.projectType.findUnique({ where: { id: project.projectTypeId } });
  const defaults = (type && DEFAULT_LOCATIONS[type.key]) || [];
  const existing = new Set((await prisma.location.findMany({
    where: { projectId: project.id }, select: { name: true },
  })).map((l) => l.name));

  const toCreate = defaults.filter((d) => !existing.has(d.name));
  if (toCreate.length > 0) {
    await prisma.location.createMany({
      data: toCreate.map((d) => ({ projectId: project.id, name: d.name, kind: d.kind })),
    });
  }
  const all = await prisma.location.findMany({
    where: { projectId: project.id }, orderBy: [{ kind: "asc" }, { name: "asc" }],
  });
  res.json(all);
});

const locationSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  kind: z.enum(["room", "area"]).default("room"),
});

// POST create a location (owner only).
router.post("/locations", async (req: AuthRequest, res: Response) => {
  const project = await loadOwnedProject(req, res);
  if (!project) return;
  const parsed = locationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: "INVALID", message: parsed.error.issues[0]?.message ?? "Invalid", hint: "" });
    return;
  }
  const loc = await prisma.location.create({
    data: { projectId: project.id, name: parsed.data.name, kind: parsed.data.kind },
  });
  res.status(201).json(loc);
});

// ─── Stage inference (pre-fill for the upload confirm UI) ─────────────────────

// GET ?capturedAt=ISO → { stageId|null, activeStages:[{id,title,color}] }. The client
// pre-selects stageId and offers activeStages when ≥2 overlap or none match.
router.get("/infer-stage", async (req: AuthRequest, res: Response) => {
  const project = await loadViewableProject(req, res);
  if (!project) return;

  const raw = (req.query.capturedAt as string) || "";
  const date = raw ? new Date(raw) : new Date();
  const when = isNaN(date.getTime()) ? new Date() : date;

  const stages = await prisma.stage.findMany({
    where: { projectId: project.id },
    select: { id: true, title: true, color: true, startDate: true, endDate: true, durationWeeks: true },
  });
  const active = activeStages(stages, when);
  res.json({
    stageId: inferStageId(stages, when),
    activeStages: active.map((s) => {
      const full = stages.find((x) => x.id === s.id)!;
      return { id: full.id, title: full.title, color: full.color };
    }),
    hasDatedStages: stages.some((s) => s.startDate != null),
  });
});

// GET stages that HAVE media, with counts — the by-stage browse index.
router.get("/by-stage", async (req: AuthRequest, res: Response) => {
  const project = await loadViewableProject(req, res);
  if (!project) return;

  const grouped = await prisma.media.groupBy({
    by: ["stageId"],
    where: { projectId: project.id },
    _count: { _all: true },
  });
  const stages = await prisma.stage.findMany({
    where: { projectId: project.id },
    select: { id: true, title: true, color: true, order: true },
    orderBy: { order: "asc" },
  });
  const countByStage = new Map(grouped.map((g) => [g.stageId, g._count._all]));

  const rows = stages
    .filter((s) => countByStage.has(s.id))
    .map((s) => ({ id: s.id, title: s.title, color: s.color, mediaCount: countByStage.get(s.id)! }));
  // "No stage" bucket (building-level / general media).
  const generalCount = countByStage.get(null) ?? 0;
  if (generalCount > 0) rows.push({ id: "", title: "כללי (ללא שלב)", color: "#9ca3af", mediaCount: generalCount });

  res.json(rows);
});

// ─── Media list (paginated, filterable) ───────────────────────────────────────

router.get("/", async (req: AuthRequest, res: Response) => {
  const project = await loadViewableProject(req, res);
  if (!project) return;

  const limit = Math.min(Math.max(parseInt((req.query.limit as string) || "50", 10) || 50, 1), 100);
  const offset = Math.max(parseInt((req.query.offset as string) || "0", 10) || 0, 0);

  const where: { projectId: string; locationId?: string | null; stageId?: string | null } = {
    projectId: project.id,
  };
  if (typeof req.query.locationId === "string") where.locationId = req.query.locationId || null;
  if (typeof req.query.stageId === "string") where.stageId = req.query.stageId || null;

  const [items, total] = await Promise.all([
    prisma.media.findMany({
      where, include: MEDIA_INCLUDE, orderBy: { capturedAt: "desc" }, take: limit, skip: offset,
    }),
    prisma.media.count({ where }),
  ]);

  res.json({ items, total, limit, offset, hasMore: offset + items.length < total });
});

// ─── Upload one file (owner only) ──────────────────────────────────────────────
// Upload-first, then DB write (eng hardening 11): no DB connection is held during the
// multi-second Cloudinary round-trip. The client fires these in a small parallel queue.

const uploadBodySchema = z.object({
  locationId: z.string().optional(),
  stageId: z.string().optional(),
  tradesperson: z.string().trim().max(120).optional(),
  caption: z.string().trim().max(500).optional(),
  capturedAt: z.string().optional(),
});

router.post("/", upload.single("file"), async (req: AuthRequest, res: Response) => {
  const project = await loadOwnedProject(req, res);
  if (!project) return;

  if (!req.file) {
    res.status(400).json({ code: "NO_FILE", message: "No file uploaded", hint: "Send multipart field 'file'" });
    return;
  }
  const parsed = uploadBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: "INVALID", message: parsed.error.issues[0]?.message ?? "Invalid", hint: "" });
    return;
  }
  const { locationId, stageId, tradesperson, caption } = parsed.data;

  // IDOR: location/stage must belong to THIS project.
  if (locationId && !(await locationBelongs(locationId, project.id))) {
    res.status(403).json({ code: "FORBIDDEN", message: "Location not in this project", hint: "" });
    return;
  }
  if (stageId && !(await stageBelongs(stageId, project.id))) {
    res.status(403).json({ code: "FORBIDDEN", message: "Stage not in this project", hint: "" });
    return;
  }

  // capturedAt: client-supplied, untrusted — validate + clamp future → now.
  let capturedAt = new Date();
  if (parsed.data.capturedAt) {
    const d = new Date(parsed.data.capturedAt);
    if (!isNaN(d.getTime()) && d.getTime() <= Date.now()) capturedAt = d;
  }

  const isVideo = req.file.mimetype.startsWith("video/");
  const folder = `onePulse/${project.ownerId}/${project.id}/imageBank`;

  let result;
  try {
    result = await uploadStream(req.file.buffer, isVideo ? "video" : "image", folder);
  } catch {
    res.status(502).json({ code: "UPLOAD_FAILED", message: "Upload to storage failed", hint: "Retry this file" });
    return;
  }

  const media = await prisma.media.create({
    data: {
      projectId: project.id,
      stageId: stageId || null,
      locationId: locationId || null,
      type: result.resourceType === "video" ? "video" : "image",
      cloudinaryId: result.publicId,
      url: result.url,
      resourceType: result.resourceType,
      caption: caption || null,
      tradesperson: tradesperson || null,
      capturedAt,
      uploadedById: req.user!.sub,
    },
    include: MEDIA_INCLUDE,
  });
  res.status(201).json(media);
});

// ─── Re-tag a single item (owner only) ─────────────────────────────────────────

const patchSchema = z.object({
  locationId: z.string().nullable().optional(),
  stageId: z.string().nullable().optional(),
  tradesperson: z.string().trim().max(120).nullable().optional(),
  caption: z.string().trim().max(500).nullable().optional(),
});

router.patch("/:mediaId", async (req: AuthRequest, res: Response) => {
  const project = await loadOwnedProject(req, res);
  if (!project) return;
  const { mediaId } = req.params as { mediaId: string };

  const existing = await prisma.media.findFirst({ where: { id: mediaId, projectId: project.id } });
  if (!existing) { res.status(404).json({ code: "NOT_FOUND", message: "Media not found", hint: "" }); return; }

  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: "INVALID", message: parsed.error.issues[0]?.message ?? "Invalid", hint: "" });
    return;
  }
  const data = parsed.data;

  if (data.locationId && !(await locationBelongs(data.locationId, project.id))) {
    res.status(403).json({ code: "FORBIDDEN", message: "Location not in this project", hint: "" });
    return;
  }
  if (data.stageId && !(await stageBelongs(data.stageId, project.id))) {
    res.status(403).json({ code: "FORBIDDEN", message: "Stage not in this project", hint: "" });
    return;
  }

  const media = await prisma.media.update({
    where: { id: mediaId },
    data: {
      ...(data.locationId !== undefined ? { locationId: data.locationId } : {}),
      ...(data.stageId !== undefined ? { stageId: data.stageId } : {}),
      ...(data.tradesperson !== undefined ? { tradesperson: data.tradesperson } : {}),
      ...(data.caption !== undefined ? { caption: data.caption } : {}),
    },
    include: MEDIA_INCLUDE,
  });
  res.json(media);
});

// ─── Delete a single item (owner only) ─────────────────────────────────────────

router.delete("/:mediaId", async (req: AuthRequest, res: Response) => {
  const project = await loadOwnedProject(req, res);
  if (!project) return;
  const { mediaId } = req.params as { mediaId: string };

  const media = await prisma.media.findFirst({ where: { id: mediaId, projectId: project.id } });
  if (!media) { res.status(404).json({ code: "NOT_FOUND", message: "Media not found", hint: "" }); return; }

  const rt = media.resourceType === "video" ? "video" : "image";
  await deleteAsset(media.cloudinaryId, rt).catch(() => { /* best-effort; row is source of truth */ });
  await prisma.media.delete({ where: { id: mediaId } });
  res.status(204).end();
});

// ─── Bulk delete ALL project media (owner only, typed confirm) ─────────────────

router.delete("/", async (req: AuthRequest, res: Response) => {
  const project = await loadOwnedProject(req, res);
  if (!project) return;

  // Typed-name confirmation — destructive + irreversible.
  if ((req.body?.confirm ?? "") !== project.name) {
    res.status(400).json({ code: "CONFIRM_MISMATCH", message: "Type the project name to confirm", hint: "" });
    return;
  }

  const prefix = `onePulse/${project.ownerId}/${project.id}/imageBank`;
  const { deleted, failed } = await deleteByPrefix(prefix);
  const { count } = await prisma.media.deleteMany({ where: { projectId: project.id } });

  // Audit trail — destructive op; capture failed publicIds (orphaned billable assets).
  console.log(JSON.stringify({
    audit: "media.bulkDelete", actorId: req.user!.sub, projectId: project.id,
    prefix, cloudinaryDeleted: deleted, rowsDeleted: count, failed,
    at: new Date().toISOString(),
  }));

  res.json({ rowsDeleted: count, cloudinaryDeleted: deleted, failed });
});

// ─── Multer-aware error handler (router-level, 4-arg) ──────────────────────────
// Multer rejects fire in middleware before the handler, so a handler try/catch never
// sees them — they must be mapped here or they collapse to the global 500.
router.use((err: unknown, _req: AuthRequest, res: Response, next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ code: "FILE_TOO_LARGE", message: "הקובץ גדול מדי (עד 100MB)", hint: "Compress or split the file" });
      return;
    }
    res.status(400).json({ code: "UPLOAD_ERROR", message: err.message, hint: "" });
    return;
  }
  // The fileFilter rejects unsupported types with a plain Error.
  if (err instanceof Error && err.message.startsWith("Unsupported file type")) {
    res.status(415).json({ code: "UNSUPPORTED_TYPE", message: "סוג קובץ לא נתמך", hint: err.message });
    return;
  }
  next(err);
});

export default router;
