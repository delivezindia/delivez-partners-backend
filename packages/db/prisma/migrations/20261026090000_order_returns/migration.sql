-- CreateEnum
CREATE TYPE "ReturnReason" AS ENUM ('DAMAGED', 'WRONG_ITEM', 'EXPIRED', 'POOR_QUALITY', 'MISSING');

-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('WITH_RIDER', 'RECEIVED', 'NOT_APPLICABLE');

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "returnedQty" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "returnWindowClosedAt" TIMESTAMP(3),
ADD COLUMN     "returnWindowEndsAt" TIMESTAMP(3),
ADD COLUMN     "returnWindowOutcome" TEXT;

-- CreateTable
CREATE TABLE "order_returns" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" "ReturnReason" NOT NULL,
    "note" TEXT,
    "status" "ReturnStatus" NOT NULL DEFAULT 'WITH_RIDER',
    "refundMethod" TEXT NOT NULL,
    "createdByType" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "restocked" BOOLEAN,
    "receivedAt" TIMESTAMP(3),
    "receivedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_returns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_returns_orderId_idx" ON "order_returns"("orderId");

-- CreateIndex
CREATE INDEX "order_returns_status_idx" ON "order_returns"("status");

-- AddForeignKey
ALTER TABLE "order_returns" ADD CONSTRAINT "order_returns_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

