import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import prisma from "../lib/prisma";
import { signAccessToken, verifyAccessToken, generateRefreshToken } from "../lib/jwt";
import { requireAuth, AuthRequest } from "../middleware/auth";

const router = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
  role: z.enum(["supervisor", "manager"]).default("supervisor"),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

router.post("/register", async (req: Request, res: Response) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: "VALIDATION_ERROR", message: "Invalid input", hint: parsed.error.flatten() });
    return;
  }

  const { email, password, name, role } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    res.status(409).json({ code: "EMAIL_TAKEN", message: "Email already registered", hint: "Try logging in instead" });
    return;
  }

  const hashed = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({ data: { email, password: hashed, name, role } });

  const accessToken = signAccessToken({ sub: user.id, email: user.email, role: user.role });
  const { token: refreshToken, expiresAt } = generateRefreshToken();
  await prisma.refreshToken.create({ data: { userId: user.id, token: refreshToken, expiresAt } });

  res.status(201).json({ accessToken, refreshToken, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

router.post("/login", async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: "VALIDATION_ERROR", message: "Invalid input", hint: parsed.error.flatten() });
    return;
  }

  const { email, password } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.password))) {
    res.status(401).json({ code: "INVALID_CREDENTIALS", message: "Email or password is incorrect", hint: "Double-check your credentials" });
    return;
  }

  const accessToken = signAccessToken({ sub: user.id, email: user.email, role: user.role });
  const { token: refreshToken, expiresAt } = generateRefreshToken();
  await prisma.refreshToken.create({ data: { userId: user.id, token: refreshToken, expiresAt } });

  res.json({ accessToken, refreshToken, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

router.post("/refresh", async (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    res.status(400).json({ code: "MISSING_TOKEN", message: "Refresh token required", hint: "Include refreshToken in request body" });
    return;
  }

  const stored = await prisma.refreshToken.findUnique({ where: { token: refreshToken }, include: { user: true } });
  if (!stored || stored.expiresAt < new Date()) {
    res.status(401).json({ code: "INVALID_REFRESH_TOKEN", message: "Refresh token is invalid or expired", hint: "Log in again" });
    return;
  }

  await prisma.refreshToken.delete({ where: { id: stored.id } });
  const accessToken = signAccessToken({ sub: stored.user.id, email: stored.user.email, role: stored.user.role });
  const { token: newRefreshToken, expiresAt } = generateRefreshToken();
  await prisma.refreshToken.create({ data: { userId: stored.user.id, token: newRefreshToken, expiresAt } });

  res.json({ accessToken, refreshToken: newRefreshToken });
});

router.get("/me", requireAuth, async (req: AuthRequest, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.sub },
    select: { id: true, email: true, name: true, role: true, companyName: true, mobileNumber: true, phoneNumber: true, whatsappNumber: true },
  });
  res.json(user);
});

const profileSchema = z.object({
  name: z.string().min(1),
  companyName: z.string().optional(),
  mobileNumber: z.string().optional(),
  phoneNumber: z.string().optional(),
  whatsappNumber: z.string().optional(),
});

router.put("/profile", requireAuth, async (req: AuthRequest, res: Response) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: "VALIDATION_ERROR", message: "Invalid input", hint: parsed.error.flatten() });
    return;
  }
  const user = await prisma.user.update({
    where: { id: req.user!.sub },
    data: {
      name: parsed.data.name,
      companyName: parsed.data.companyName || null,
      mobileNumber: parsed.data.mobileNumber || null,
      phoneNumber: parsed.data.phoneNumber || null,
      whatsappNumber: parsed.data.whatsappNumber || null,
    },
    select: { id: true, email: true, name: true, role: true, companyName: true, mobileNumber: true, phoneNumber: true, whatsappNumber: true },
  });
  res.json(user);
});

const changePasswordSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string().min(8),
});

router.put("/change-password", requireAuth, async (req: AuthRequest, res: Response) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ code: "VALIDATION_ERROR", message: "Invalid input", hint: parsed.error.flatten() });
    return;
  }
  const user = await prisma.user.findUnique({ where: { id: req.user!.sub } });
  if (!user || !(await bcrypt.compare(parsed.data.currentPassword, user.password))) {
    res.status(401).json({ code: "INVALID_PASSWORD", message: "Current password is incorrect", hint: "" });
    return;
  }
  const hashed = await bcrypt.hash(parsed.data.newPassword, 12);
  await prisma.user.update({ where: { id: req.user!.sub }, data: { password: hashed } });
  res.json({ ok: true });
});

export default router;
