-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Stage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "durationWeeks" INTEGER,
    "startDate" DATETIME,
    "endDate" DATETIME,
    "order" INTEGER NOT NULL,
    "dependsOnId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Stage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Stage_dependsOnId_fkey" FOREIGN KEY ("dependsOnId") REFERENCES "Stage" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Stage" ("color", "createdAt", "description", "durationWeeks", "endDate", "id", "order", "projectId", "startDate", "title", "updatedAt") SELECT "color", "createdAt", "description", "durationWeeks", "endDate", "id", "order", "projectId", "startDate", "title", "updatedAt" FROM "Stage";
DROP TABLE "Stage";
ALTER TABLE "new_Stage" RENAME TO "Stage";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
