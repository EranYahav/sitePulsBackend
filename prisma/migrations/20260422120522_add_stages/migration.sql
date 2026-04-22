/*
  Warnings:

  - You are about to drop the column `phaseId` on the `Defect` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Project" ADD COLUMN "actualEndDate" DATETIME;
ALTER TABLE "Project" ADD COLUMN "actualStartDate" DATETIME;

-- CreateTable
CREATE TABLE "Stage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "durationWeeks" INTEGER,
    "startDate" DATETIME,
    "endDate" DATETIME,
    "order" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Stage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Defect_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Defect_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "Stage" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Defect" ("cloudinaryId", "createdAt", "description", "domain", "id", "photoUrl", "projectId", "reminderDate", "status", "title", "trackingNotes", "tradesperson", "updatedAt", "urgency") SELECT "cloudinaryId", "createdAt", "description", "domain", "id", "photoUrl", "projectId", "reminderDate", "status", "title", "trackingNotes", "tradesperson", "updatedAt", "urgency" FROM "Defect";
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Report_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Report_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Report_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "Stage" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Report" ("authorId", "createdAt", "id", "notes", "pdfPublicId", "projectId", "reportData", "status", "title", "updatedAt") SELECT "authorId", "createdAt", "id", "notes", "pdfPublicId", "projectId", "reportData", "status", "title", "updatedAt" FROM "Report";
DROP TABLE "Report";
ALTER TABLE "new_Report" RENAME TO "Report";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
