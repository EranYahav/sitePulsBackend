import { defineConfig } from "vitest/config";
import path from "node:path";

// Absolute path avoids Prisma's relative-SQLite-path ambiguity (CLI resolves relative to
// prisma/, the client relative to CWD). Tests run against a throwaway test.db, never dev.db.
const TEST_DB = `file:${path.resolve(__dirname, "prisma/test.db").replace(/\\/g, "/")}`;

export default defineConfig({
  test: {
    env: { DATABASE_URL: TEST_DB },
    globalSetup: "./test/globalSetup.ts",
    // SQLite serializes writes; run test files in a single fork to avoid lock flakiness.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    include: ["test/**/*.test.ts"],
    hookTimeout: 60000,
  },
});
