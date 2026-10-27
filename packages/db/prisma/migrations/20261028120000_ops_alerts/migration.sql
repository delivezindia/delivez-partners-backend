-- AlterTable
ALTER TABLE "riders" ADD COLUMN     "pausedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ops_alerts" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "cityId" TEXT,
    "kind" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "breachedAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" TEXT,
    "acknowledgedBy" TEXT,
    "action" TEXT,
    "actionAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "history" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "ops_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ops_alerts_resolvedAt_cityId_idx" ON "ops_alerts"("resolvedAt", "cityId");

-- CreateIndex
CREATE INDEX "ops_alerts_detectedAt_idx" ON "ops_alerts"("detectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ops_alerts_orderId_kind_key" ON "ops_alerts"("orderId", "kind");

