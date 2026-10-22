-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DocumentType" ADD VALUE 'NABL_CERTIFICATE';
ALTER TYPE "DocumentType" ADD VALUE 'CLINICAL_ESTABLISHMENT_REG';
ALTER TYPE "DocumentType" ADD VALUE 'PATHOLOGIST_REGISTRATION';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StoreType" ADD VALUE 'DIAGNOSTIC_LAB';
ALTER TYPE "StoreType" ADD VALUE 'DIAGNOSTIC_CHAIN';
ALTER TYPE "StoreType" ADD VALUE 'HOSPITAL_LAB';

-- AlterEnum
ALTER TYPE "Vertical" ADD VALUE 'DIAGNOSTICS';

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "labFastingHours" INTEGER,
ADD COLUMN     "labHomeCollection" BOOLEAN,
ADD COLUMN     "labParameters" INTEGER,
ADD COLUMN     "labPreparation" TEXT,
ADD COLUMN     "labReportHours" INTEGER,
ADD COLUMN     "labSampleType" TEXT,
ADD COLUMN     "labWalkIn" BOOLEAN;

-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "collectionFee" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "pathologists" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "qualification" TEXT NOT NULL,
    "registrationNo" TEXT NOT NULL,
    "stateCouncil" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "consentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pathologists_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pathologists_registrationNo_stateCouncil_storeId_key" ON "pathologists"("registrationNo", "stateCouncil", "storeId");

-- AddForeignKey
ALTER TABLE "pathologists" ADD CONSTRAINT "pathologists_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
