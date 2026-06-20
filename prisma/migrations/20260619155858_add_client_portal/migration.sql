-- AlterTable
ALTER TABLE "User" ADD COLUMN "companyLogoCloudinaryId" TEXT;
ALTER TABLE "User" ADD COLUMN "companyLogoUrl" TEXT;

-- CreateTable
CREATE TABLE "ShareLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" DATETIME,
    "lastViewedAt" DATETIME,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ShareLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Defect" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "stageId" TEXT,
    "title" TEXT NOT NULL,
    "photoUrl" TEXT NOT NULL,
    "cloudinaryId" TEXT NOT NULL,
    "urgency" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "description" TEXT,
    "tradesperson" TEXT,
    "reminderDate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'open',
    "trackingNotes" TEXT,
    "clientVisible" BOOLEAN NOT NULL DEFAULT false,
    "resolvedPhotoUrl" TEXT,
    "resolvedCloudinaryId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Defect_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Defect_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "Stage" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Defect" ("cloudinaryId", "createdAt", "description", "domain", "id", "photoUrl", "projectId", "reminderDate", "stageId", "status", "title", "trackingNotes", "tradesperson", "updatedAt", "urgency") SELECT "cloudinaryId", "createdAt", "description", "domain", "id", "photoUrl", "projectId", "reminderDate", "stageId", "status", "title", "trackingNotes", "tradesperson", "updatedAt", "urgency" FROM "Defect";
DROP TABLE "Defect";
ALTER TABLE "new_Defect" RENAME TO "Defect";
CREATE TABLE "new_Report" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "stageId" TEXT,
    "notes" TEXT NOT NULL,
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reportData" TEXT,
    "pdfPublicId" TEXT,
    "clientPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Report_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Report_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Report_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "Stage" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Report" ("authorId", "createdAt", "id", "notes", "pdfPublicId", "projectId", "reportData", "stageId", "status", "title", "updatedAt") SELECT "authorId", "createdAt", "id", "notes", "pdfPublicId", "projectId", "reportData", "stageId", "status", "title", "updatedAt" FROM "Report";
DROP TABLE "Report";
ALTER TABLE "new_Report" RENAME TO "Report";
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
    "templateId" TEXT,
    "completedAt" DATETIME,
    "clientPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Stage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Stage_dependsOnId_fkey" FOREIGN KEY ("dependsOnId") REFERENCES "Stage" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Stage_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "StageTemplate" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Stage" ("color", "createdAt", "dependsOnId", "description", "durationWeeks", "endDate", "id", "order", "projectId", "startDate", "templateId", "title", "updatedAt") SELECT "color", "createdAt", "dependsOnId", "description", "durationWeeks", "endDate", "id", "order", "projectId", "startDate", "templateId", "title", "updatedAt" FROM "Stage";
DROP TABLE "Stage";
ALTER TABLE "new_Stage" RENAME TO "Stage";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ShareLink_projectId_key" ON "ShareLink"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ShareLink_token_key" ON "ShareLink"("token");

-- CreateIndex
CREATE INDEX "ShareLink_token_idx" ON "ShareLink"("token");
