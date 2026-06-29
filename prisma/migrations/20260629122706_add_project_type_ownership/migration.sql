-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ProjectType" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL DEFAULT '__system__',
    "key" TEXT NOT NULL,
    "nameHe" TEXT NOT NULL,
    "nameEn" TEXT,
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "originId" TEXT,
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_ProjectType" ("createdAt", "description", "id", "isActive", "key", "nameEn", "nameHe", "order") SELECT "createdAt", "description", "id", "isActive", "key", "nameEn", "nameHe", "order" FROM "ProjectType";
DROP TABLE "ProjectType";
ALTER TABLE "new_ProjectType" RENAME TO "ProjectType";
CREATE INDEX "ProjectType_ownerId_idx" ON "ProjectType"("ownerId");
CREATE UNIQUE INDEX "ProjectType_ownerId_key_key" ON "ProjectType"("ownerId", "key");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
