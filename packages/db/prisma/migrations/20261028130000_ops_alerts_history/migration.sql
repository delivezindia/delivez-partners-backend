-- DropIndex
DROP INDEX "ops_alerts_orderId_kind_key";

-- CreateIndex
CREATE INDEX "ops_alerts_orderId_kind_idx" ON "ops_alerts"("orderId", "kind");


-- Only one OPEN alert per order + kind; resolved alerts stay as history.
CREATE UNIQUE INDEX "ops_alerts_open_order_kind_key" ON "ops_alerts"("orderId", "kind") WHERE "resolvedAt" IS NULL;
