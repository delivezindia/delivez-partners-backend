-- Customer-app lab bookings paid online (Razorpay): pay first, then book.
CREATE TABLE "lab_payments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" "PaymentMode" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "providerOrderId" TEXT,
    "providerPaymentId" TEXT,
    "providerRefundId" TEXT,
    "refundAmount" INTEGER NOT NULL DEFAULT 0,
    "bookingId" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "lab_payments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "lab_payments_providerOrderId_key" ON "lab_payments"("providerOrderId");
CREATE UNIQUE INDEX "lab_payments_providerPaymentId_key" ON "lab_payments"("providerPaymentId");
CREATE UNIQUE INDEX "lab_payments_bookingId_key" ON "lab_payments"("bookingId");
CREATE INDEX "lab_payments_status_createdAt_idx" ON "lab_payments"("status", "createdAt");
CREATE INDEX "lab_payments_userId_createdAt_idx" ON "lab_payments"("userId", "createdAt");
