import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";

// Build a throwaway SQLite DB, apply migrations, seed the system catalog. Runs once
// before the suite. Never touches dev.db.
export default function setup() {
  const dbPath = path.resolve(__dirname, "../prisma/test.db");
  const url = `file:${dbPath.replace(/\\/g, "/")}`;
  for (const f of [dbPath, `${dbPath}-journal`, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (existsSync(f)) rmSync(f);
  }
  const env = { ...process.env, DATABASE_URL: url };
  const cwd = path.resolve(__dirname, "..");
  execSync("npx prisma migrate deploy", { cwd, env, stdio: "inherit" });
  execSync("npx prisma db seed", { cwd, env, stdio: "inherit" });
}
