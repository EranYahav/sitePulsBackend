import { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";

export function requestId(req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Request-ID", uuidv4());
  next();
}
