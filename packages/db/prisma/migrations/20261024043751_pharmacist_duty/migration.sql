-- AlterTable
ALTER TABLE "pharmacists" ADD COLUMN     "dutyOverride" BOOLEAN,
ADD COLUMN     "dutyOverrideUntil" TIMESTAMP(3);
