import { Router, Response } from "express";
import { portalAuth, PortalRequest } from "../middleware/portalAuth";
import { buildClientPortal, allowedImageIds } from "../lib/clientProjection";
import { signedImageUrl } from "../services/cloudinary";
import prisma from "../lib/prisma";

// Public, unauthenticated client portal. Mounted at /api/v1/portal — NO requireAuth.
// Every route goes through portalAuth (token resolve + revoke/expiry + noindex).
//
//   GET /api/v1/portal/:token            → the client portal payload (allowlist projection)
//   GET /api/v1/portal/:token/image/:id  → revocation-checked image proxy
//
const router = Router();

router.use("/:token", portalAuth);

// GET /api/v1/portal/:token
router.get("/:token", async (req: PortalRequest, res: Response) => {
  try {
    const dto = await buildClientPortal(req.shareLink!.projectId, req.shareLink!.token);
    if (!dto) {
      res.status(404).json({ code: "NOT_FOUND", message: "Portal not found", hint: "" });
      return;
    }

    // Read-receipt (E4) — a "view" is the client actually opening the portal page, so we
    // track it here (once per page load) and not in the middleware (which also runs for
    // every image request). Skipped for the inspector's own ?preview=1 visit.
    // Fire-and-forget so a tracking write never blocks or breaks the page load.
    if (!req.isPreview) {
      prisma.shareLink
        .update({
          where: { id: req.shareLink!.id },
          data: { lastViewedAt: new Date(), viewCount: { increment: 1 } },
        })
        .catch(() => { /* tracking is best-effort; never surface to the client */ });
    }

    res.json(dto);
  } catch (err) {
    console.error("portal payload failed", { projectId: req.shareLink?.projectId, err });
    res.status(500).json({ code: "INTERNAL_ERROR", message: "Something went wrong", hint: "" });
  }
});

// GET /api/v1/portal/:token/image/:cloudinaryId
// On every request: token already validated (portalAuth) — so a revoked/expired link
// 404s here too, cutting off image access. We also confirm the requested asset belongs
// to a client-visible item, so the proxy can't fetch arbitrary Cloudinary assets.
router.get("/:token/image/:cloudinaryId", async (req: PortalRequest, res: Response) => {
  try {
    const cloudinaryId = decodeURIComponent(req.params["cloudinaryId"] as string);
    const allowed = await allowedImageIds(req.shareLink!.projectId);
    if (!allowed.has(cloudinaryId)) {
      res.status(404).json({ code: "NOT_FOUND", message: "Image not found", hint: "" });
      return;
    }
    // Redirect to a signed, short-lived delivery URL. The portal HTML never holds a
    // raw Cloudinary URL — only this proxy path — so revocation is enforced per request.
    res.redirect(302, signedImageUrl(cloudinaryId));
  } catch (err) {
    console.error("portal image proxy failed", { projectId: req.shareLink?.projectId, err });
    res.status(500).json({ code: "INTERNAL_ERROR", message: "Something went wrong", hint: "" });
  }
});

export default router;
