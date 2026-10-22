-- CreateEnum
CREATE TYPE "LabBookingStatus" AS ENUM ('BOOKED', 'RX_REVIEW', 'CONFIRMED', 'COLLECTOR_ASSIGNED', 'SAMPLE_COLLECTED', 'PROCESSING', 'REPORT_READY', 'CANCELLED', 'REJECTED');

-- CreateEnum
CREATE TYPE "LabCollectionType" AS ENUM ('HOME', 'WALK_IN');

-- CreateTable
CREATE TABLE "lab_bookings" (
    "id" TEXT NOT NULL,
    "bookingNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "channel" "OrderChannel" NOT NULL,
    "status" "LabBookingStatus" NOT NULL DEFAULT 'BOOKED',
    "collectionType" "LabCollectionType" NOT NULL,
    "slotStart" TIMESTAMP(3) NOT NULL,
    "slotMinutes" INTEGER NOT NULL DEFAULT 60,
    "patientName" TEXT NOT NULL,
    "patientAge" INTEGER,
    "patientGender" TEXT,
    "address" JSONB,
    "distanceKm" DOUBLE PRECISION,
    "itemsSubtotal" INTEGER NOT NULL,
    "collectionFee" INTEGER NOT NULL DEFAULT 0,
    "grandTotal" INTEGER NOT NULL,
    "paymentMode" "PaymentMode" NOT NULL,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "refundAmount" INTEGER NOT NULL DEFAULT 0,
    "rxRequired" BOOLEAN NOT NULL DEFAULT false,
    "prescriptionId" TEXT,
    "rxSeenByStore" BOOLEAN NOT NULL DEFAULT false,
    "collectionOtp" TEXT NOT NULL,
    "collectorName" TEXT,
    "collectorPhone" TEXT,
    "collectorAssignedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "collectedAt" TIMESTAMP(3),
    "processingAt" TIMESTAMP(3),
    "reportReadyAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "cancelReason" TEXT,
    "customerNote" TEXT,
    "isTestBooking" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lab_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_booking_items" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "testName" TEXT NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "isRx" BOOLEAN NOT NULL DEFAULT false,
    "sampleType" TEXT,
    "fastingHours" INTEGER,
    "reportHours" INTEGER,

    CONSTRAINT "lab_booking_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_booking_events" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "fromState" "LabBookingStatus",
    "toState" "LabBookingStatus" NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "reason" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lab_booking_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_reports" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "fileKey" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "pathologistId" TEXT NOT NULL,
    "releasedById" TEXT NOT NULL,
    "summary" TEXT,
    "amendReason" TEXT,
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lab_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_report_accesses" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "userId" TEXT,
    "actorType" TEXT NOT NULL,
    "purpose" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lab_report_accesses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lab_bookings_bookingNumber_key" ON "lab_bookings"("bookingNumber");

-- CreateIndex
CREATE INDEX "lab_bookings_storeId_status_slotStart_idx" ON "lab_bookings"("storeId", "status", "slotStart");

-- CreateIndex
CREATE INDEX "lab_bookings_customerId_createdAt_idx" ON "lab_bookings"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "lab_booking_items_bookingId_idx" ON "lab_booking_items"("bookingId");

-- CreateIndex
CREATE INDEX "lab_booking_events_bookingId_createdAt_idx" ON "lab_booking_events"("bookingId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "lab_reports_bookingId_version_key" ON "lab_reports"("bookingId", "version");

-- CreateIndex
CREATE INDEX "lab_report_accesses_reportId_createdAt_idx" ON "lab_report_accesses"("reportId", "createdAt");

-- AddForeignKey
ALTER TABLE "lab_bookings" ADD CONSTRAINT "lab_bookings_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_bookings" ADD CONSTRAINT "lab_bookings_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_bookings" ADD CONSTRAINT "lab_bookings_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "prescriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_booking_items" ADD CONSTRAINT "lab_booking_items_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "lab_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_booking_items" ADD CONSTRAINT "lab_booking_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_booking_events" ADD CONSTRAINT "lab_booking_events_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "lab_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_reports" ADD CONSTRAINT "lab_reports_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "lab_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_reports" ADD CONSTRAINT "lab_reports_pathologistId_fkey" FOREIGN KEY ("pathologistId") REFERENCES "pathologists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_report_accesses" ADD CONSTRAINT "lab_report_accesses_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "lab_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
