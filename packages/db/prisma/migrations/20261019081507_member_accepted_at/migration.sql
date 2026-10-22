-- AlterTable
ALTER TABLE "partner_members" ADD COLUMN     "acceptedAt" TIMESTAMP(3);

-- Existing active members joined when they were created.
UPDATE "partner_members" SET "acceptedAt" = "createdAt" WHERE "isActive" = true;
