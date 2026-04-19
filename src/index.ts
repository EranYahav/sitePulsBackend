import "dotenv/config";
import express from "express";
import cors from "cors";
import { requestId } from "./middleware/requestId";
import authRouter from "./routes/auth";
import projectsRouter from "./routes/projects";
import reportsRouter, { getReport } from "./routes/reports";
import { requireAuth } from "./middleware/auth";

const app = express();

app.use(cors());
app.use(express.json());
app.use(requestId);

app.get("/api/v1/health", (_req, res) => {
  res.json({ status: "ok", service: "site-pulse-backend" });
});

app.use("/api/v1/auth", authRouter);
app.use("/api/v1/projects", projectsRouter);
app.use("/api/v1/projects/:projectId/reports", reportsRouter);
app.get("/api/v1/reports/:id", requireAuth, (req, res) => getReport(req as import("./middleware/auth").AuthRequest, res));

// Global error handler — returns {code, message, hint} on unhandled errors
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ code: "INTERNAL_ERROR", message: "Something went wrong", hint: "Check server logs" });
});

const PORT = process.env.PORT ?? 4702;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
