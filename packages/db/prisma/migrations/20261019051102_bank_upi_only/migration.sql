-- AlterTable
ALTER TABLE "bank_accounts" ALTER COLUMN "accountNumberEnc" DROP NOT NULL,
ALTER COLUMN "accountNumberLast4" DROP NOT NULL,
ALTER COLUMN "ifsc" DROP NOT NULL;
