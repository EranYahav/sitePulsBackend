import { Router, Response } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import prisma from "../lib/prisma";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { SYSTEM_OWNER_ID } from "../lib/systemOwner";
import { forkType } from "../lib/forkType";

const router = Router();
router.use(requireAuth);

// Max stage templates per type — mirrors the per-project MAX_STAGES in stages.ts so a
// project seeded from an owned type can never exceed the limit the rest of the app assumes.
const MAX_STAGES = 20;

const typeCreateSchema = z.object({
  nameHe: z.string().min(1).max(100),
  nameEn: z.string().max(100).optional().nullable(),
  description: z.string().max(500).optional().nullable(),
});
const typePatchSchema = z.object({
  nameHe: z.string().min(1).max(100).optional(),
  nameEn: z.string().max(100).optional().nullable(),
  description: z.string().max(500).optional().nullable(),
  order: z.number().int().min(0).optional(),
});
const stageSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().max(500).optional().nullable(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  defaultDurationWeeks: z.number().int().min(1).max(104).optional().nullable(),
});
const stagePatchSchema = stageSchema.partial();
const checkSchema = z.object({ text: z.string().min(1).max(300) });
const reorderSchema = z.object({ order: z.array(z.string().uuid()).min(1) });

const err = (res: Response, status: number, code: string, message: string, hint = "") =>
  res.status(status).json({ code, message, hint });

const isSupervisor = (req: AuthRequest) => req.user!.role === "supervisor";

// ── Effective merged catalog ─────────────────────────────────────────────────
// A supervisor's catalog = system rows whose key is neither overridden nor tombstoned
// by one of their owned rows, UNION their own non-hidden rows. Managers get the read-only
// system defaults only.
router.get("/", async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.sub;
    const withCounts = {
      stageTemplates: { select: { _count: { select: { checkTemplates: true } } } },
      _count: { select: { stageTemplates: true } },
    } as const;

    const system = await prisma.projectType.findMany({
      where: { ownerId: SYSTEM_OWNER_ID },
      orderBy: { order: "asc" },
      include: withCounts,
    });

    const owned = isSupervisor(req)
      ? await prisma.projectType.findMany({
          where: { ownerId: userId },
          orderBy: { order: "asc" },
          include: withCounts,
        })
      : [];

    const ownedKeys = new Set(owned.map((t) => t.key));
    const shape = (t: (typeof system)[number], isSystem: boolean) => ({
      id: t.id,
      key: t.key,
      nameHe: t.nameHe,
      nameEn: t.nameEn,
      description: t.description,
      order: t.order,
      isSystem,
      stageCount: t._count.stageTemplates,
      checkCount: t.stageTemplates.reduce((n, s) => n + s._count.checkTemplates, 0),
    });

    const merged = [
      // system defaults the supervisor hasn't overridden/tombstoned
      ...system.filter((s) => !ownedKeys.has(s.key)).map((s) => shape(s, true)),
      // the supervisor's own non-hidden rows (overrides + brand-new types)
      ...owned.filter((o) => !o.isHidden).map((o) => shape(o, false)),
    ].sort((a, b) => a.order - b.order || a.nameHe.localeCompare(b.nameHe));

    res.json(merged);
  } catch (e) {
    console.error("[project-types GET /] failed:", e);
    err(res, 500, "INTERNAL_ERROR", (e as Error).message);
  }
});

// Full nested view of one type (read). System types and the caller's own types are
// viewable; another supervisor's owned type is not.
router.get("/:id/templates", async (req: AuthRequest, res: Response) => {
  const id = req.params["id"] as string;
  const type = await prisma.projectType.findUnique({
    where: { id },
    include: {
      stageTemplates: {
        orderBy: { order: "asc" },
        include: { checkTemplates: { orderBy: { order: "asc" } } },
      },
    },
  });
  if (!type) return err(res, 404, "NOT_FOUND", "Project type not found");
  if (type.ownerId !== SYSTEM_OWNER_ID && type.ownerId !== req.user!.sub) {
    return err(res, 404, "NOT_FOUND", "Project type not found");
  }
  res.json(type);
});

// ── Fork-on-edit: materialize an owned copy of a system default ──────────────
// Idempotent. The frontend calls this before editing a default's stages/checks so the
// subsequent edits operate on owned ids.
router.post("/:id/fork", async (req: AuthRequest, res: Response) => {
  if (!isSupervisor(req)) return err(res, 403, "FORBIDDEN", "Only supervisors manage templates");
  try {
    const owned = await forkType(req.params["id"] as string, req.user!.sub);
    res.status(201).json(owned);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes("not found")) return err(res, 404, "NOT_FOUND", "Project type not found");
    if (msg.includes("only system")) return err(res, 409, "ALREADY_OWNED", "This type is already yours");
    console.error("[project-types fork] failed:", e);
    err(res, 500, "INTERNAL_ERROR", msg);
  }
});

// ── Create a brand-new owned type ────────────────────────────────────────────
router.post("/", async (req: AuthRequest, res: Response) => {
  if (!isSupervisor(req)) return err(res, 403, "FORBIDDEN", "Only supervisors manage templates");
  const parsed = typeCreateSchema.safeParse(req.body);
  if (!parsed.success) return err(res, 400, "VALIDATION_ERROR", "Invalid body", JSON.stringify(parsed.error.flatten()));

  const userId = req.user!.sub;
  const maxOrder = await prisma.projectType.aggregate({ where: { ownerId: userId }, _max: { order: true } });
  try {
    const created = await prisma.projectType.create({
      data: {
        ownerId: userId,
        key: `custom_${randomUUID()}`, // opaque per decision 2A — never derived from the (Hebrew) name
        nameHe: parsed.data.nameHe,
        nameEn: parsed.data.nameEn ?? null,
        description: parsed.data.description ?? null,
        order: (maxOrder._max.order ?? -1) + 1,
      },
    });
    res.status(201).json(created);
  } catch (e) {
    console.error("[project-types POST /] failed:", e);
    err(res, 500, "INTERNAL_ERROR", (e as Error).message);
  }
});

// Resolve the type the caller may mutate. System default → fork first. Another
// supervisor's row → null (404). Returns the OWNED type, or null if forbidden/missing.
async function resolveOwnedType(typeId: string, userId: string) {
  const type = await prisma.projectType.findUnique({ where: { id: typeId } });
  if (!type) return { error: "NOT_FOUND" as const };
  if (type.ownerId === userId) return { type };
  if (type.ownerId === SYSTEM_OWNER_ID) return { type: await forkType(typeId, userId) };
  return { error: "NOT_FOUND" as const }; // another supervisor's row — don't reveal it exists
}

// ── Edit type fields ─────────────────────────────────────────────────────────
router.patch("/:id", async (req: AuthRequest, res: Response) => {
  if (!isSupervisor(req)) return err(res, 403, "FORBIDDEN", "Only supervisors manage templates");
  const parsed = typePatchSchema.safeParse(req.body);
  if (!parsed.success) return err(res, 400, "VALIDATION_ERROR", "Invalid body", JSON.stringify(parsed.error.flatten()));
  const r = await resolveOwnedType(req.params["id"] as string, req.user!.sub);
  if (r.error) return err(res, 404, "NOT_FOUND", "Project type not found");
  const updated = await prisma.projectType.update({ where: { id: r.type.id }, data: parsed.data });
  res.json(updated);
});

// ── Delete a type / hide a default ───────────────────────────────────────────
// Owned new type → real delete. Override or system default → tombstone (so the default
// does not reappear): owned row, same key, isHidden=true, subtree removed.
router.delete("/:id", async (req: AuthRequest, res: Response) => {
  if (!isSupervisor(req)) return err(res, 403, "FORBIDDEN", "Only supervisors manage templates");
  const userId = req.user!.sub;
  const type = await prisma.projectType.findUnique({ where: { id: req.params["id"] as string } });
  if (!type) return err(res, 404, "NOT_FOUND", "Project type not found");

  if (type.ownerId === SYSTEM_OWNER_ID) {
    // tombstone the default for this supervisor (upsert: a prior override becomes a tombstone)
    await prisma.$transaction(async (tx) => {
      const existing = await tx.projectType.findUnique({ where: { ownerId_key: { ownerId: userId, key: type.key } } });
      if (existing) {
        await tx.stageTemplate.deleteMany({ where: { projectTypeId: existing.id } });
        await tx.projectType.update({ where: { id: existing.id }, data: { isHidden: true } });
      } else {
        await tx.projectType.create({ data: { ownerId: userId, key: type.key, originId: type.id, isHidden: true, nameHe: type.nameHe } });
      }
    });
    return res.json({ ok: true, tombstoned: true });
  }

  if (type.ownerId !== userId) return err(res, 404, "NOT_FOUND", "Project type not found");

  if (type.originId) {
    // override of a default → keep a tombstone so the default stays hidden
    await prisma.$transaction(async (tx) => {
      await tx.stageTemplate.deleteMany({ where: { projectTypeId: type.id } });
      await tx.projectType.update({ where: { id: type.id }, data: { isHidden: true } });
    });
    return res.json({ ok: true, tombstoned: true });
  }

  // brand-new owned type → real delete (cascade removes stage/check templates)
  await prisma.projectType.delete({ where: { id: type.id } });
  res.json({ ok: true });
});

// ── Stage templates (require an OWNED type; fork-on-edit handled by frontend via /fork) ──
async function requireOwnedTypeForWrite(req: AuthRequest, res: Response) {
  if (!isSupervisor(req)) { err(res, 403, "FORBIDDEN", "Only supervisors manage templates"); return null; }
  const type = await prisma.projectType.findUnique({ where: { id: req.params["id"] as string } });
  if (!type) { err(res, 404, "NOT_FOUND", "Project type not found"); return null; }
  if (type.ownerId === SYSTEM_OWNER_ID) {
    err(res, 409, "NEEDS_FORK", "Customize this type first", "POST /project-types/:id/fork, then edit the owned copy");
    return null;
  }
  if (type.ownerId !== req.user!.sub) { err(res, 404, "NOT_FOUND", "Project type not found"); return null; }
  return type;
}

router.post("/:id/stages", async (req: AuthRequest, res: Response) => {
  const type = await requireOwnedTypeForWrite(req, res);
  if (!type) return;
  const parsed = stageSchema.safeParse(req.body);
  if (!parsed.success) return err(res, 400, "VALIDATION_ERROR", "Invalid body", JSON.stringify(parsed.error.flatten()));
  const count = await prisma.stageTemplate.count({ where: { projectTypeId: type.id } });
  if (count >= MAX_STAGES) return err(res, 400, "STAGE_LIMIT", `Maximum ${MAX_STAGES} stages per type`);
  const max = await prisma.stageTemplate.aggregate({ where: { projectTypeId: type.id }, _max: { order: true } });
  const stage = await prisma.stageTemplate.create({
    data: {
      projectTypeId: type.id,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      color: parsed.data.color ?? "#6366f1",
      defaultDurationWeeks: parsed.data.defaultDurationWeeks ?? null,
      order: (max._max.order ?? -1) + 1,
    },
  });
  res.status(201).json(stage);
});

// Verify a stage belongs to the caller's owned type (IDOR guard via parent re-join).
async function ownedStage(stageId: string, userId: string) {
  const stage = await prisma.stageTemplate.findUnique({ where: { id: stageId }, include: { projectType: true } });
  if (!stage || stage.projectType.ownerId !== userId) return null;
  return stage;
}

router.patch("/:id/stages/:stageId", async (req: AuthRequest, res: Response) => {
  const type = await requireOwnedTypeForWrite(req, res);
  if (!type) return;
  const parsed = stagePatchSchema.safeParse(req.body);
  if (!parsed.success) return err(res, 400, "VALIDATION_ERROR", "Invalid body", JSON.stringify(parsed.error.flatten()));
  const stage = await ownedStage(req.params["stageId"] as string, req.user!.sub);
  if (!stage || stage.projectTypeId !== type.id) return err(res, 404, "NOT_FOUND", "Stage not found");
  const updated = await prisma.stageTemplate.update({ where: { id: stage.id }, data: parsed.data });
  res.json(updated);
});

router.delete("/:id/stages/:stageId", async (req: AuthRequest, res: Response) => {
  const type = await requireOwnedTypeForWrite(req, res);
  if (!type) return;
  const stage = await ownedStage(req.params["stageId"] as string, req.user!.sub);
  if (!stage || stage.projectTypeId !== type.id) return err(res, 404, "NOT_FOUND", "Stage not found");
  await prisma.stageTemplate.delete({ where: { id: stage.id } });
  res.json({ ok: true });
});

router.put("/:id/stages/reorder", async (req: AuthRequest, res: Response) => {
  const type = await requireOwnedTypeForWrite(req, res);
  if (!type) return;
  const parsed = reorderSchema.safeParse(req.body);
  if (!parsed.success) return err(res, 400, "VALIDATION_ERROR", "order must be an array of ids");
  const stages = await prisma.stageTemplate.findMany({ where: { projectTypeId: type.id }, select: { id: true } });
  const valid = new Set(stages.map((s) => s.id));
  if (parsed.data.order.length !== stages.length || !parsed.data.order.every((id) => valid.has(id))) {
    return err(res, 400, "INVALID_ORDER", "order must list exactly this type's stage ids");
  }
  await prisma.$transaction(parsed.data.order.map((id, i) => prisma.stageTemplate.update({ where: { id }, data: { order: i } })));
  const updated = await prisma.stageTemplate.findMany({ where: { projectTypeId: type.id }, orderBy: { order: "asc" } });
  res.json(updated);
});

// ── Check templates ──────────────────────────────────────────────────────────
router.post("/:id/stages/:stageId/checks", async (req: AuthRequest, res: Response) => {
  const type = await requireOwnedTypeForWrite(req, res);
  if (!type) return;
  const parsed = checkSchema.safeParse(req.body);
  if (!parsed.success) return err(res, 400, "VALIDATION_ERROR", "text required");
  const stage = await ownedStage(req.params["stageId"] as string, req.user!.sub);
  if (!stage || stage.projectTypeId !== type.id) return err(res, 404, "NOT_FOUND", "Stage not found");
  const max = await prisma.checkTemplate.aggregate({ where: { stageTemplateId: stage.id }, _max: { order: true } });
  const check = await prisma.checkTemplate.create({
    data: { stageTemplateId: stage.id, text: parsed.data.text, order: (max._max.order ?? -1) + 1 },
  });
  res.status(201).json(check);
});

// Verify a check belongs to a stage of the caller's owned type (IDOR via two-level re-join).
async function ownedCheck(checkId: string, userId: string) {
  const check = await prisma.checkTemplate.findUnique({
    where: { id: checkId },
    include: { stageTemplate: { include: { projectType: true } } },
  });
  if (!check || check.stageTemplate.projectType.ownerId !== userId) return null;
  return check;
}

router.patch("/:id/stages/:stageId/checks/:checkId", async (req: AuthRequest, res: Response) => {
  const type = await requireOwnedTypeForWrite(req, res);
  if (!type) return;
  const parsed = checkSchema.safeParse(req.body);
  if (!parsed.success) return err(res, 400, "VALIDATION_ERROR", "text required");
  const check = await ownedCheck(req.params["checkId"] as string, req.user!.sub);
  if (!check || check.stageTemplate.projectTypeId !== type.id) return err(res, 404, "NOT_FOUND", "Check not found");
  const updated = await prisma.checkTemplate.update({ where: { id: check.id }, data: { text: parsed.data.text } });
  res.json(updated);
});

router.delete("/:id/stages/:stageId/checks/:checkId", async (req: AuthRequest, res: Response) => {
  const type = await requireOwnedTypeForWrite(req, res);
  if (!type) return;
  const check = await ownedCheck(req.params["checkId"] as string, req.user!.sub);
  if (!check || check.stageTemplate.projectTypeId !== type.id) return err(res, 404, "NOT_FOUND", "Check not found");
  await prisma.checkTemplate.delete({ where: { id: check.id } });
  res.json({ ok: true });
});

router.put("/:id/stages/:stageId/checks/reorder", async (req: AuthRequest, res: Response) => {
  const type = await requireOwnedTypeForWrite(req, res);
  if (!type) return;
  const parsed = reorderSchema.safeParse(req.body);
  if (!parsed.success) return err(res, 400, "VALIDATION_ERROR", "order must be an array of ids");
  const stage = await ownedStage(req.params["stageId"] as string, req.user!.sub);
  if (!stage || stage.projectTypeId !== type.id) return err(res, 404, "NOT_FOUND", "Stage not found");
  const checks = await prisma.checkTemplate.findMany({ where: { stageTemplateId: stage.id }, select: { id: true } });
  const valid = new Set(checks.map((c) => c.id));
  if (parsed.data.order.length !== checks.length || !parsed.data.order.every((id) => valid.has(id))) {
    return err(res, 400, "INVALID_ORDER", "order must list exactly this stage's check ids");
  }
  await prisma.$transaction(parsed.data.order.map((id, i) => prisma.checkTemplate.update({ where: { id }, data: { order: i } })));
  const updated = await prisma.checkTemplate.findMany({ where: { stageTemplateId: stage.id }, orderBy: { order: "asc" } });
  res.json(updated);
});

export default router;
