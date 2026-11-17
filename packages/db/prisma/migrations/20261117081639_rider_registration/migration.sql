-- CreateEnum
CREATE TYPE "RiderApplicationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "RiderDocumentType" AS ENUM ('PHOTO', 'DRIVING_LICENCE', 'VEHICLE_RC', 'VEHICLE_INSURANCE', 'BANK_PROOF');

-- AlterTable
ALTER TABLE "riders" ADD COLUMN     "suspendReason" TEXT,
ADD COLUMN     "suspendedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "rider_applications" (
    "id" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "status" "RiderApplicationStatus" NOT NULL DEFAULT 'DRAFT',
    "cityId" TEXT,
    "personalInfo" JSONB,
    "legalVehicle" JSONB,
    "workTech" JSONB,
    "hyperlocal" JSONB,
    "trainingRole" JSONB,
    "safetyCompliance" JSONB,
    "consentAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rider_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rider_documents" (
    "id" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "type" "RiderDocumentType" NOT NULL,
    "fileKey" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "rejectReason" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rider_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rider_applications_riderId_key" ON "rider_applications"("riderId");

-- CreateIndex
CREATE INDEX "rider_applications_status_submittedAt_idx" ON "rider_applications"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "rider_applications_cityId_status_idx" ON "rider_applications"("cityId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "rider_documents_riderId_type_key" ON "rider_documents"("riderId", "type");

-- AddForeignKey
ALTER TABLE "rider_applications" ADD CONSTRAINT "rider_applications_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "riders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rider_documents" ADD CONSTRAINT "rider_documents_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "riders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
