import { Router, Response } from "express";
import { z } from "zod";
import prisma from "../lib/prisma";
import { signAccessToken } from "../lib/jwt";
import { requireAuth, requireAdmin, AuthRequest } from "../middleware/auth";

const router = Router();

// Every admin route requires a valid token AND isAdmin. An impersonation token
// carries the target user's (non-admin) claims, so requireAdmin also blocks an
// impersonating admin from re-entering admin tooling — you act fully as the user.
router.use(requireAuth, requireAdmin);

// GET /admin/users — the app-wide user roster for the admin Users table.
// Returns identity + role + tier + join date, plus a starter set of activity
// counts (projects owned, reports authored, media uploaded). Defects/gallery
// breakdowns can be layered on later without changing the row shape.
router.get("/users", async (_req: AuthRequest, res: Response) => {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isAdmin: true,
      tier: true,
      createdAt: true,
      _count: {
        select: {
          ownedProjects: true,
          reports: true,
          uploadedMedia: true,
        },
      },
    },
  });

  res.json(
    users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      isAdmin: u.isAdmin,
      tier: u.tier,
      createdAt: u.createdAt,
      stats: {
        projects: u._count.ownedProjects,
        reports: u._count.reports,
        media: u._count.uploadedMedia,
      },
    })),
  );
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.enum(["supervisor", "manager"]).optional(),
  tier: z.number().int().min(0).optional(),
  isAdmin: z.boolean().optional(),
});

// PATCH /admin/users/:id — edit a user's name/role/tier/admin flag.
router.patch("/users/:id", async (req: AuthRequest, res: Response) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: "VALIDATION_ERROR", message: "Invalid input", hint: parsed.error.flatten() });
    return;
  }

  const id = String(req.params.id);
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) {
    res.status(404).json({ code: "USER_NOT_FOUND", message: "User not found", hint: "" });
    return;
  }

  // Lockout guard: an admin cannot strip their own admin flag (avoids the last
  // admin accidentally locking everyone out of the Users tooling).
  if (target.id === req.user!.sub && parsed.data.isAdmin === false) {
    res.status(400).json({ code: "CANNOT_DEMOTE_SELF", message: "You cannot remove your own admin access", hint: "Ask another admin to do it" });
    return;
  }

  const user = await prisma.user.update({
    where: { id: target.id },
    data: parsed.data,
    select: { id: true, email: true, name: true, role: true, isAdmin: true, tier: true },
  });
  res.json(user);
});

// POST /admin/users/:id/impersonate — mint a reversible impersonation token.
// The token carries the TARGET user's identity + an impersonatedBy marker so
// the app shows a banner and the admin can return. No refresh token is issued:
// the session is self-contained and longer-lived, and on expiry the admin
// simply returns to their own (backed-up) session on the client.
router.post("/users/:id/impersonate", async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id);
  if (id === req.user!.sub) {
    res.status(400).json({ code: "CANNOT_IMPERSONATE_SELF", message: "You are already yourself", hint: "" });
    return;
  }

  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, name: true, role: true, isAdmin: true, tier: true },
  });
  if (!target) {
    res.status(404).json({ code: "USER_NOT_FOUND", message: "User not found", hint: "" });
    return;
  }

  const accessToken = signAccessToken(
    {
      sub: target.id,
      email: target.email,
      role: target.role,
      isAdmin: target.isAdmin,
      impersonatedBy: req.user!.email,
    },
    { expiresIn: "8h" },
  );

  res.json({ accessToken, user: { ...target, impersonatedBy: req.user!.email } });
});

export default router;
