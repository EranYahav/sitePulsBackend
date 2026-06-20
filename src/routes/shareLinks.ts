import { Router, Response } from "express";
import { z } from "zod";
import prisma from "../lib/prisma";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { getProjectWithAccess } from "./projects";
import { generatePortalToken } from "../middleware/portalAuth";

// Inspector-side management of the one live client portal link per project.
//   GET    /projects/:projectId/share-link  → current link (or null)
//   POST   /projects/:projectId/share-link  → create or rotate the token (default 90d expiry)
//   DELETE /projects/:projectId/share-link  → revoke (instant cutoff, incl. images via proxy)
const router = Router({ mergeParams: true });

router.use(requireAuth);

const DEFAULT_EXPIRY_DAYS = 90;

const createSchema = z.object({
  expiryDays: z.number().int().min(1).max(365).optional(),
});

// Never expose the raw token-row internals beyond what the inspector UI needs.
function serialize(link: {
  token: string; revoked: boolean; expiresAt: Date | null;
  lastViewedAt: Date | null; viewCount: number; createdAt: Date;
}) {
  return {
    token: link.token,
    revoked: link.revoked,
    expiresAt: link.expiresAt?.toISOString() ?? null,
    lastViewedAt: link.lastViewedAt?.toISOString() ?? null,
    viewCount: link.viewCount,
    createdAt: link.createdAt.toISOString(),
  };
}

router.get("/", async (req: AuthRequest, res: Response) => {
  const { projectId } = req.params as { projectId: string };
  const project = await getProjectWithAccess(projectId, req.user!.sub, req.user!.role);
  if (!project) {
    res.status(404).json({ code: "NOT_FOUND", message: "Project not found", hint: "" });
    return;
  }
  const link = await prisma.shareLink.findUnique({ where: { projectId } });
  res.json(link ? serialize(link) : null);
});

router.post("/", async (req: AuthRequest, res: Response) => {
  const { projectId } = req.params as { projectId: string };
  if (req.user!.role !== "supervisor") {
    res.status(403).json({ code: "FORBIDDEN", message: "Only supervisors can create share links", hint: "" });
    return;
  }
  const project = await getProjectWithAccess(projectId, req.user!.sub, req.user!.role);
  if (!project) {
    res.status(404).json({ code: "NOT_FOUND", message: "Project not found", hint: "" });
    return;
  }
  const parsed = createSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ code: "VALIDATION_ERROR", message: "Invalid input", hint: parsed.error.flatten() });
    return;
  }
  const days = parsed.data.expiryDays ?? DEFAULT_EXPIRY_DAYS;
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const token = generatePortalToken();

  // One link per project (@unique projectId). Creating again rotates the token and
  // clears revoke/expiry — the old token stops working immediately.
  const link = await prisma.shareLink.upsert({
    where: { projectId },
    create: { projectId, token, expiresAt },
    update: { token, revoked: false, expiresAt, lastViewedAt: null, viewCount: 0 },
  });
  res.status(201).json(serialize(link));
});

router.delete("/", async (req: AuthRequest, res: Response) => {
  const { projectId } = req.params as { projectId: string };
  if (req.user!.role !== "supervisor") {
    res.status(403).json({ code: "FORBIDDEN", message: "Only supervisors can revoke share links", hint: "" });
    return;
  }
  const project = await getProjectWithAccess(projectId, req.user!.sub, req.user!.role);
  if (!project) {
    res.status(404).json({ code: "NOT_FOUND", message: "Project not found", hint: "" });
    return;
  }
  const existing = await prisma.shareLink.findUnique({ where: { projectId } });
  if (!existing) {
    res.status(404).json({ code: "NOT_FOUND", message: "No share link to revoke", hint: "" });
    return;
  }
  await prisma.shareLink.update({ where: { projectId }, data: { revoked: true } });
  res.status(204).send();
});

export default router;
