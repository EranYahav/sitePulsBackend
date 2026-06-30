-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'supervisor',
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "tier" INTEGER NOT NULL DEFAULT 0,
    "companyName" TEXT,
    "companyLogoUrl" TEXT,
    "companyLogoCloudinaryId" TEXT,
    "mobileNumber" TEXT,
    "phoneNumber" TEXT,
    "whatsappNumber" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_User" ("companyLogoCloudinaryId", "companyLogoUrl", "companyName", "createdAt", "email", "id", "mobileNumber", "name", "password", "phoneNumber", "role", "whatsappNumber") SELECT "companyLogoCloudinaryId", "companyLogoUrl", "companyName", "createdAt", "email", "id", "mobileNumber", "name", "password", "phoneNumber", "role", "whatsappNumber" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
