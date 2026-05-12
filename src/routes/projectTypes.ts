import { Router, Response } from "express";
import prisma from "../lib/prisma";
import { requireAuth, AuthRequest } from "../middleware/auth";

const router = Router();

router.use(requireAuth);

// GET /api/v1/project-types — list active types, ordered, with stage/check counts.
router.get("/", async (_req: AuthRequest, res: Response) => {
  try {
    const types = await prisma.projectType.findMany({
      where: { isActive: true },
      orderBy: { order: "asc" },
      include: {
        _count: { select: { stageTemplates: true } },
      },
    });
    res.json(types);
  } catch (e) {
    console.error("[project-types GET /] failed:", e);
    res.status(500).json({ code: "INTERNAL_ERROR", message: (e as Error).message, hint: "" });
  }
});

// GET /api/v1/project-types/:id/templates — full nested view used for preview / re-import diff.
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
  if (!type) {
    res.status(404).json({ code: "NOT_FOUND", message: "Project type not found", hint: "" });
    return;
  }
  res.json(type);
});

export default router;
