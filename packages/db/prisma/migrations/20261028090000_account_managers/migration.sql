-- AlterEnum
ALTER TYPE "AdminRole" ADD VALUE 'ACCOUNT_MANAGER';

-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "accountManagerId" TEXT;

-- CreateTable
CREATE TABLE "am_tasks" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "dueAt" TIMESTAMP(3) NOT NULL,
    "doneAt" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "am_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "am_activities" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "note" TEXT,
    "meta" JSONB,
    "clientId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "am_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "am_issues" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "orderId" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "owner" TEXT NOT NULL DEFAULT 'AM',
    "dueAt" TIMESTAMP(3) NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "note" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "am_issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "am_tasks_adminId_doneAt_dueAt_idx" ON "am_tasks"("adminId", "doneAt", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "am_activities_clientId_key" ON "am_activities"("clientId");

-- CreateIndex
CREATE INDEX "am_activities_storeId_createdAt_idx" ON "am_activities"("storeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "am_issues_dedupeKey_key" ON "am_issues"("dedupeKey");

-- CreateIndex
CREATE INDEX "am_issues_storeId_status_idx" ON "am_issues"("storeId", "status");

-- CreateIndex
CREATE INDEX "stores_accountManagerId_idx" ON "stores"("accountManagerId");

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_accountManagerId_fkey" FOREIGN KEY ("accountManagerId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "am_tasks" ADD CONSTRAINT "am_tasks_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "am_tasks" ADD CONSTRAINT "am_tasks_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "am_activities" ADD CONSTRAINT "am_activities_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "am_activities" ADD CONSTRAINT "am_activities_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "am_issues" ADD CONSTRAINT "am_issues_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

