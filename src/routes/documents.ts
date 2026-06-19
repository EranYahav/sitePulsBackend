import { Router, Response } from "express";
import { z } from "zod";
import prisma from "../lib/prisma";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { getProjectWithAccess } from "./projects";

// ─── Documents (external resource links) ────────────────────────────────────
// A Resource is a labeled external link (Google Drive / OneDrive / Dropbox / any
// URL) to a plan or doc. Links only — never fetched server-side (no SSRF). The
// provider brand icon is derived on the client from the URL hostname; `kind`
// ("file" | "folder") is stored.
//
// Route ordering note: PATCH /reorder MUST be declared before PATCH /:id, or
// Express binds :id = "reorder" and the reorder route is dead.
// ─────────────────────────────────────────────────────────────────────────────

const router = Router({ mergeParams: true });

const PIN_LIMIT = 3;
// Generous URL ceiling — Google Drive / SharePoint links with resourcekey/usp
// params run long (well past 500 chars). SQLite stores url as TEXT (no DB cap);
// this is the only length constraint.
const URL_MAX = 8192;

// Scheme checked BEFORE format, so a bad scheme gets the friendly message and a
// malformed URL gets a clear format error.
const urlSchema = z
  .string()
  .refine((u) => /^https?:\/\//i.test(u), "Only http/https links are allowed")
  .pipe(z.string().url("Enter a valid URL").max(URL_MAX));

const kindSchema = z.enum(["file", "folder"]);

const createSchema = z.object({
  label: z.string().min(1, "Label is required").max(100),
  url: urlSchema,
  kind: kindSchema.default("file"),
});

const patchSchema = z.object({
  label: z.string().min(1).max(100).optional(),
  url: urlSchema.optional(),
  kind: kindSchema.optional(),
  isPinned: z.boolean().optional(),
});

const reorderSchema = z.object({ ids: z.array(z.string()).min(1) });

// Sentinel errors thrown inside interactive transactions, mapped to HTTP below.
class PinLimitError extends Error {}
class ReorderMismatchError extends Error {}

router.use(requireAuth);

// GET /projects/:projectId/documents — any project member
router.get("/", async (req: AuthRequest, res: Response) => {
  const { projectId } = req.params as { projectId: string };

  const project = await getProjectWithAccess(projectId, req.user!.sub, req.user!.role);
  if (!project) {
    res.status(404).json({ code: "NOT_FOUND", message: "Project not found", hint: "" });
    return;
  }

  const documents = await prisma.resource.findMany({
    where: { projectId },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
  res.json(documents);
});

// POST /projects/:projectId/documents — supervisor only
router.post("/", async (req: AuthRequest, res: Response) => {
  const { projectId } = req.params as { projectId: string };

  if (req.user!.role !== "supervisor") {
    res.status(403).json({ code: "FORBIDDEN", message: "Only supervisors can add documents", hint: "" });
    return;
  }

  const project = await getProjectWithAccess(projectId, req.user!.sub, req.user!.role);
  if (!project) {
    res.status(404).json({ code: "NOT_FOUND", message: "Project not found", hint: "" });
    return;
  }

  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: "VALIDATION_ERROR", message: "Invalid fields", hint: parsed.error.flatten() });
    return;
  }

  // Compute order = max+1 and insert atomically (no create-order TOCTOU).
  const created = await prisma.$transaction(async (tx) => {
    const agg = await tx.resource.aggregate({ where: { projectId }, _max: { order: true } });
    const nextOrder = (agg._max.order ?? -1) + 1;
    return tx.resource.create({
      data: {
        projectId,
        label: parsed.data.label,
        url: parsed.data.url,
        kind: parsed.data.kind,
        order: nextOrder,
        createdById: req.user!.sub,
      },
    });
  });

  res.status(201).json(created);
});

// PATCH /projects/:projectId/documents/reorder — supervisor only.
// MUST be declared before PATCH /:id.
router.patch("/reorder", async (req: AuthRequest, res: Response) => {
  const { projectId } = req.params as { projectId: string };

  if (req.user!.role !== "supervisor") {
    res.status(403).json({ code: "FORBIDDEN", message: "Only supervisors can reorder documents", hint: "" });
    return;
  }

  const project = await getProjectWithAccess(projectId, req.user!.sub, req.user!.role);
  if (!project) {
    res.status(404).json({ code: "NOT_FOUND", message: "Project not found", hint: "" });
    return;
  }

  const parsed = reorderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: "VALIDATION_ERROR", message: "Invalid ids", hint: parsed.error.flatten() });
    return;
  }
  const ids = parsed.data.ids;

  // No duplicates allowed.
  if (new Set(ids).size !== ids.length) {
    res.status(400).json({ code: "VALIDATION_ERROR", message: "Duplicate ids in reorder", hint: "" });
    return;
  }

  try {
    const reordered = await prisma.$transaction(async (tx) => {
      const existing = await tx.resource.findMany({ where: { projectId }, select: { id: true } });
      const existingIds = new Set(existing.map((r) => r.id));
      // Submitted set must exactly match the project's resource ids (closes IDOR
      // + partial-order). Any foreign or missing id is rejected.
      if (ids.length !== existingIds.size || !ids.every((id) => existingIds.has(id))) {
        throw new ReorderMismatchError();
      }
      await Promise.all(ids.map((id, idx) => tx.resource.update({ where: { id }, data: { order: idx } })));
      return tx.resource.findMany({ where: { projectId }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] });
    });
    res.json(reordered);
  } catch (err) {
    if (err instanceof ReorderMismatchError) {
      res.status(400).json({ code: "REORDER_MISMATCH", message: "ids must match this project's documents exactly", hint: "" });
      return;
    }
    throw err;
  }
});

// PATCH /projects/:projectId/documents/:id — supervisor only (label/url/kind/isPinned)
router.patch("/:id", async (req: AuthRequest, res: Response) => {
  const { projectId, id } = req.params as { projectId: string; id: string };

  if (req.user!.role !== "supervisor") {
    res.status(403).json({ code: "FORBIDDEN", message: "Only supervisors can edit documents", hint: "" });
    return;
  }

  const project = await getProjectWithAccess(projectId, req.user!.sub, req.user!.role);
  if (!project) {
    res.status(404).json({ code: "NOT_FOUND", message: "Project not found", hint: "" });
    return;
  }

  const existing = await prisma.resource.findUnique({ where: { id } });
  if (!existing || existing.projectId !== projectId) {
    res.status(404).json({ code: "NOT_FOUND", message: "Document not found", hint: "" });
    return;
  }

  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: "VALIDATION_ERROR", message: "Invalid fields", hint: parsed.error.flatten() });
    return;
  }
  const data = parsed.data;

  try {
    const updated = await prisma.$transaction(async (tx) => {
      // Enforce the pin cap inside the transaction (no read-then-write race).
      if (data.isPinned === true && !existing.isPinned) {
        const pinnedCount = await tx.resource.count({ where: { projectId, isPinned: true } });
        if (pinnedCount >= PIN_LIMIT) throw new PinLimitError();
      }
      return tx.resource.update({
        where: { id },
        data: {
          ...(data.label !== undefined && { label: data.label }),
          ...(data.url !== undefined && { url: data.url }),
          ...(data.kind !== undefined && { kind: data.kind }),
          ...(data.isPinned !== undefined && { isPinned: data.isPinned }),
        },
      });
    });
    res.json(updated);
  } catch (err) {
    if (err instanceof PinLimitError) {
      res.status(400).json({ code: "PIN_LIMIT_REACHED", message: `You can pin up to ${PIN_LIMIT} documents`, hint: "Unpin one first" });
      return;
    }
    throw err;
  }
});

// DELETE /projects/:projectId/documents/:id — supervisor only
router.delete("/:id", async (req: AuthRequest, res: Response) => {
  const { projectId, id } = req.params as { projectId: string; id: string };

  if (req.user!.role !== "supervisor") {
    res.status(403).json({ code: "FORBIDDEN", message: "Only supervisors can delete documents", hint: "" });
    return;
  }

  const project = await getProjectWithAccess(projectId, req.user!.sub, req.user!.role);
  if (!project) {
    res.status(404).json({ code: "NOT_FOUND", message: "Project not found", hint: "" });
    return;
  }

  const existing = await prisma.resource.findUnique({ where: { id } });
  if (!existing || existing.projectId !== projectId) {
    res.status(404).json({ code: "NOT_FOUND", message: "Document not found", hint: "" });
    return;
  }

  await prisma.resource.delete({ where: { id } });
  res.status(204).send();
});

export default router;
