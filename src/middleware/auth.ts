import { Request, Response, NextFunction } from "express";
import { verifyAccessToken, JwtPayload } from "../lib/jwt";

export interface AuthRequest extends Request {
  user?: JwtPayload;
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ code: "UNAUTHORIZED", message: "Missing token", hint: "Include Authorization: Bearer <token>" });
    return;
  }

  try {
    req.user = verifyAccessToken(header.slice(7));
    next();
  } catch {
    res.status(401).json({ code: "INVALID_TOKEN", message: "Token is invalid or expired", hint: "Request a new token via POST /api/v1/auth/refresh" });
  }
}

export function requireRole(role: string) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (req.user?.role !== role) {
      res.status(403).json({ code: "FORBIDDEN", message: "Insufficient permissions", hint: `This route requires role: ${role}` });
      return;
    }
    next();
  };
}
