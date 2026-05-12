import { Router, Response } from "express";
import { z } from "zod";
import prisma from "../lib/prisma";
import { requireAuth, AuthRequest } from "../middleware/auth";

const router = Router();

router.use(requireAuth);

const KEY_REGEX = /^[a-z0-9_]+$/;

const createSchema = z.object({
  key: z.string().min(1).max(40).regex(KEY_REGEX, "Lowercase letters, digits, underscore only"),
  nameHe: z.string().min(1).max(80),
  nameEn: z.string().max(80).optional().nullable(),
  order: z.number().int().min(0).max(10000).optional(),
  isActive: z.boolean().optional(),
});

const updateSchema = z.object({
  nameHe: z.string().min(1).max(80).optional(),
  nameEn: z.string().max(80).optional().nullable(),
  order: z.number().int().min(0).max(10000).optional(),
  isActive: z.boolean().optional(),
});

// GET /api/v1/defect-domains?includeInactive=1
// Response rows include a `usage` field — the number of defects referencing the domain key.
router.get("/", async (req: AuthRequest, res: Response) => {
  const includeInactive = req.query.includeInactive === "1";
  const [domains, counts] = await Promise.all([
    prisma.defectDomain.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ order: "asc" }, { nameHe: "asc" }],
    }),
    prisma.defect.groupBy({ by: ["domain"], _count: { domain: true } }),
  ]);
  const countByKey = new Map<string, number>(
    counts.map((c) => [c.domain, c._count.domain]),
  );
  res.json(domains.map((d) => ({ ...d, usage: countByKey.get(d.key) ?? 0 })));
});

// POST /api/v1/defect-domains
router.post("/", async (req: AuthRequest, res: Response) => {
  if (req.user!.role !== "supervisor") {
    res.status(403).json({ code: "FORBIDDEN", message: "Only supervisors can edit domains", hint: "" });
    return;
  }
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: "VALIDATION_ERROR", message: "Invalid input", hint: parsed.error.flatten() });
    return;
  }

  // Check uniqueness explicitly so we return a clean 409 instead of a Prisma constraint error.
  const dup = await prisma.defectDomain.findUnique({ where: { key: parsed.data.key } });
  if (dup) {
    res.status(409).json({ code: "DUPLICATE_KEY", message: "A domain with this key already exists", hint: "" });
    return;
  }

  const created = await prisma.defectDomain.create({
    data: {
      key: parsed.data.key,
      nameHe: parsed.data.nameHe,
      nameEn: parsed.data.nameEn ?? null,
      order: parsed.data.order ?? 0,
      isActive: parsed.data.isActive ?? true,
    },
  });
  res.status(201).json(created);
});

// PATCH /api/v1/defect-domains/:id
router.patch("/:id", async (req: AuthRequest, res: Response) => {
  if (req.user!.role !== "supervisor") {
    res.status(403).json({ code: "FORBIDDEN", message: "Only supervisors can edit domains", hint: "" });
    return;
  }
  const id = req.params["id"] as string;
  const existing = await prisma.defectDomain.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ code: "NOT_FOUND", message: "Domain not found", hint: "" });
    return;
  }
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: "VALIDATION_ERROR", message: "Invalid input", hint: parsed.error.flatten() });
    return;
  }
  const data: Record<string, unknown> = {};
  if (parsed.data.nameHe !== undefined) data.nameHe = parsed.data.nameHe;
  if (parsed.data.nameEn !== undefined) data.nameEn = parsed.data.nameEn ?? null;
  if (parsed.data.order !== undefined) data.order = parsed.data.order;
  if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive;

  const updated = await prisma.defectDomain.update({ where: { id }, data });
  res.json(updated);
});

// Locked keys cannot be hard-deleted — they are required by the system (e.g. the
// fallback "other" domain used by the auto-defect side-effect on a failed check).
const LOCKED_KEYS = new Set(["other"]);

// DELETE /api/v1/defect-domains/:id
// Refuses if: domain is locked, or any Defect rows still reference its key.
// To retire an in-use domain, PATCH { isActive: false } instead.
router.delete("/:id", async (req: AuthRequest, res: Response) => {
  if (req.user!.role !== "supervisor") {
    res.status(403).json({ code: "FORBIDDEN", message: "Only supervisors can delete domains", hint: "" });
    return;
  }
  const id = req.params["id"] as string;
  const existing = await prisma.defectDomain.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ code: "NOT_FOUND", message: "Domain not found", hint: "" });
    return;
  }

  if (LOCKED_KEYS.has(existing.key)) {
    res.status(409).json({
      code: "LOCKED_DOMAIN",
      message: "This domain is required by the system and cannot be deleted",
      hint: "You can deactivate it with PATCH { isActive: false } instead",
    });
    return;
  }

  const usage = await prisma.defect.count({ where: { domain: existing.key } });
  if (usage > 0) {
    res.status(409).json({
      code: "DOMAIN_IN_USE",
      message: "Cannot delete a domain that is in use",
      hint: { usage },
    });
    return;
  }

  await prisma.defectDomain.delete({ where: { id } });
  res.status(204).send();
});

export default router;
