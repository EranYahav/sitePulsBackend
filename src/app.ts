import "dotenv/config";
import express from "express";
import cors from "cors";
import { requestId } from "./middleware/requestId";
import authRouter from "./routes/auth";
import projectsRouter from "./routes/projects";
import reportsRouter, { getReport } from "./routes/reports";
import defectsRouter from "./routes/defects";
import stagesRouter from "./routes/stages";
import documentsRouter from "./routes/documents";
import projectTypesRouter from "./routes/projectTypes";
import checksRouter from "./routes/checks";
import mediaRouter from "./routes/media";
import defectDomainsRouter from "./routes/defectDomains";
import portalRouter from "./routes/portal";
import shareLinksRouter from "./routes/shareLinks";
import { requireAuth } from "./middleware/auth";

const app = express();

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : ["http://localhost:4701"];

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());
app.use(requestId);

app.get("/api/v1/health", (_req, res) => {
  res.json({ status: "ok", service: "site-pulse-backend" });
});

// Public client portal — NO auth (token-scoped via portalAuth middleware).
app.use("/api/v1/portal", portalRouter);

app.use("/api/v1/auth", authRouter);
app.use("/api/v1/project-types", projectTypesRouter);
app.use("/api/v1/defect-domains", defectDomainsRouter);
app.use("/api/v1/projects", projectsRouter);
app.use("/api/v1/projects/:projectId/reports", reportsRouter);
app.use("/api/v1/projects/:projectId/defects", defectsRouter);
app.use("/api/v1/projects/:projectId/stages", stagesRouter);
app.use("/api/v1/projects/:projectId/share-link", shareLinksRouter);
app.use("/api/v1/projects/:projectId/documents", documentsRouter);
app.use("/api/v1/projects/:projectId/media", mediaRouter);
app.use("/api/v1/projects/:projectId/stages/:stageId/checks", checksRouter);
app.get("/api/v1/reports/:id", requireAuth, (req, res) =>
  getReport(req as import("./middleware/auth").AuthRequest, res),
);

// Global error handler — returns {code, message, hint} on unhandled errors
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(err);
    res.status(500).json({
      code: "INTERNAL_ERROR",
      message: "Something went wrong",
      hint: "Check server logs",
    });
  },
);

export default app;
