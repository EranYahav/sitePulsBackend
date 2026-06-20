import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import prisma from "../lib/prisma";

// Public client-portal access. NOT JWT — resolves an unguessable ShareLink token.
// A leaked/guessed token is the whole risk surface, so: 256-bit tokens, revoke +
// expiry honored here, a 404 (never 401) for bad/revoked/expired tokens so we never
// reveal whether a token "exists", and noindex/no-referrer on every response.

export interface PortalRequest extends Request {
  shareLink?: { id: string; projectId: string; token: string };
  // set by the inspector "View as Client" preview path so view-tracking is skipped
  isPreview?: boolean;
}

export function generatePortalToken(): string {
  // 32 bytes = 256-bit, URL-safe, unguessable
  return crypto.randomBytes(32).toString("base64url");
}

function notFound(res: Response) {
  // Deliberately identical for missing / revoked / expired — no existence oracle.
  res.status(404).json({ code: "NOT_FOUND", message: "Portal not found", hint: "" });
}

export async function portalAuth(req: PortalRequest, res: Response, next: NextFunction) {
  // Defense in depth: portals must never be cached by shared proxies or indexed.
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "private, max-age=60");

  const rawToken = req.params["token"];
  const token = typeof rawToken === "string" ? rawToken : undefined;
  if (!token || token.length < 16) return notFound(res);

  const link = await prisma.shareLink.findUnique({ where: { token } });
  if (!link || link.revoked) return notFound(res);
  if (link.expiresAt && link.expiresAt.getTime() < Date.now()) return notFound(res);

  req.shareLink = { id: link.id, projectId: link.projectId, token: link.token };

  // Read-receipt (E4) — fire-and-forget so a tracking write never blocks or breaks
  // the homeowner's page load. Skipped for the inspector's own preview.
  if (!req.isPreview) {
    prisma.shareLink
      .update({
        where: { id: link.id },
        data: { lastViewedAt: new Date(), viewCount: { increment: 1 } },
      })
      .catch(() => { /* tracking is best-effort; never surface to the client */ });
  }

  next();
}
