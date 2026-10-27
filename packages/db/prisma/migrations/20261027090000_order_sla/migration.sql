-- AlterEnum
ALTER TYPE "ReturnReason" ADD VALUE 'UNDELIVERED';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "cancelCode" TEXT,
ADD COLUMN     "cancelFault" TEXT,
ADD COLUMN     "cancelStage" TEXT,
ADD COLUMN     "customerDue" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "storeCompensation" INTEGER NOT NULL DEFAULT 0;

