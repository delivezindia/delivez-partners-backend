-- Coupons managed from the admin panel: city targeting, first-order-only, listed vs code-only, who made it.
ALTER TABLE "coupons" ADD COLUMN "cityId" TEXT,
ADD COLUMN "firstOrderOnly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "isPublic" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "createdById" TEXT,
ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "coupons_isActive_endsAt_idx" ON "coupons"("isActive", "endsAt");
CREATE INDEX "coupon_redemptions_couponId_idx" ON "coupon_redemptions"("couponId");
CREATE INDEX "coupon_redemptions_customerId_couponId_idx" ON "coupon_redemptions"("customerId", "couponId");

ALTER TABLE "coupons" ADD CONSTRAINT "coupons_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
