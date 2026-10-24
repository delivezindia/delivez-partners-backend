-- CreateEnum
CREATE TYPE "SubstitutionStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'DECLINED', 'EXPIRED');

-- AlterTable
ALTER TABLE "support_tickets" ADD COLUMN     "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "storeId" TEXT,
ADD COLUMN     "ticketNumber" TEXT;

-- AlterTable
ALTER TABLE "ticket_messages" ADD COLUMN     "fromAdmin" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "order_substitutions" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "variantId" TEXT,
    "variantName" TEXT,
    "qty" INTEGER NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "lineTotal" INTEGER NOT NULL,
    "taxRatePct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "SubstitutionStatus" NOT NULL DEFAULT 'PROPOSED',
    "note" TEXT,
    "proposedByUserId" TEXT,
    "respondBy" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_substitutions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_substitutions_orderId_idx" ON "order_substitutions"("orderId");

-- CreateIndex
CREATE INDEX "order_substitutions_status_respondBy_idx" ON "order_substitutions"("status", "respondBy");

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_ticketNumber_key" ON "support_tickets"("ticketNumber");

-- CreateIndex
CREATE INDEX "support_tickets_storeId_createdAt_idx" ON "support_tickets"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "ticket_messages_ticketId_createdAt_idx" ON "ticket_messages"("ticketId", "createdAt");

-- AddForeignKey
ALTER TABLE "order_substitutions" ADD CONSTRAINT "order_substitutions_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

