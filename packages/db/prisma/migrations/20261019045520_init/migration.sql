-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'BLOCKED', 'DELETED');

-- CreateEnum
CREATE TYPE "Language" AS ENUM ('EN', 'HI', 'KN', 'TA', 'TE', 'ML', 'MR', 'BN');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('LOGIN', 'ONBOARDING', 'BANK_CHANGE', 'PHONE_CHANGE');

-- CreateEnum
CREATE TYPE "AppId" AS ENUM ('PARTNERS', 'LOCAL', 'ADMIN', 'RIDER', 'ONE');

-- CreateEnum
CREATE TYPE "DevicePlatform" AS ENUM ('ANDROID', 'IOS', 'WEB');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('FOUNDER', 'HEAD_OF_OPS', 'REGIONAL_HEAD', 'CITY_OPS', 'COMPLIANCE', 'FINANCE', 'LEGAL', 'SUPPORT', 'SALES_AGENT', 'AUDITOR');

-- CreateEnum
CREATE TYPE "PartnerType" AS ENUM ('INDIVIDUAL', 'PROPRIETORSHIP', 'PARTNERSHIP', 'PVT_LTD', 'LLP', 'OTHER');

-- CreateEnum
CREATE TYPE "PartnerRole" AS ENUM ('OWNER', 'MANAGER', 'KITCHEN_LEAD', 'COUNTER_STAFF', 'PHARMACIST', 'ACCOUNTANT');

-- CreateEnum
CREATE TYPE "Vertical" AS ENUM ('EAT', 'GROCERY', 'PHARMACY', 'LOCAL_STORES', 'RUSH', 'FETCH');

-- CreateEnum
CREATE TYPE "StoreType" AS ENUM ('RESTAURANT', 'CLOUD_KITCHEN', 'SUPERMARKET', 'KIRANA', 'GROCERY', 'PHARMACY_RETAIL', 'PHARMACY_CHAIN', 'PHARMACY_HOSPITAL', 'BAKERY', 'MEAT_FISH', 'FLOWER', 'ELECTRONICS', 'CLOTHING', 'BEAUTY_WELLNESS', 'HOUSEHOLD_LIFESTYLE', 'BABY_CARE', 'PET_CARE', 'PRINTING', 'STREET_VENDOR', 'SOCIETY_VENDOR', 'OTHER');

-- CreateEnum
CREATE TYPE "StoreStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'LIVE', 'LIMITED', 'PAUSED', 'SUSPENDED', 'REJECTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "StoreOpenState" AS ENUM ('OPEN', 'BUSY', 'CLOSED');

-- CreateEnum
CREATE TYPE "OnboardingChannel" AS ENUM ('WEB', 'MOBILE', 'WHATSAPP', 'ADMIN');

-- CreateEnum
CREATE TYPE "OnboardingStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'NEEDS_CHANGES', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('FSSAI', 'GSTIN', 'PAN', 'DRUG_LICENSE_DL20', 'DRUG_LICENSE_DL21', 'PHARMACIST_REGISTRATION', 'ADDRESS_PROOF', 'BANK_PROOF', 'SHOP_ESTABLISHMENT', 'TRADE_LICENSE', 'LANDMARK_PHOTO', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "BankVerificationStatus" AS ENUM ('UNVERIFIED', 'PENNY_DROP_PENDING', 'VERIFIED', 'FAILED');

-- CreateEnum
CREATE TYPE "LegalDocType" AS ENUM ('PARTNER_TNC', 'SLA_TERMS', 'STATE_RIDER', 'PENALTY_FRAMEWORK', 'CUSTOMER_TNC', 'PRIVACY_POLICY', 'RX_DECLARATION', 'WHATSAPP_OPT_IN');

-- CreateEnum
CREATE TYPE "DrugSchedule" AS ENUM ('NONE', 'OTC', 'H', 'H1', 'X');

-- CreateEnum
CREATE TYPE "InventoryMovementType" AS ENUM ('PURCHASE', 'SALE', 'RESERVE', 'RELEASE', 'ADJUSTMENT', 'EXPIRY_WRITEOFF', 'RETURN');

-- CreateEnum
CREATE TYPE "AddressLabel" AS ENUM ('HOME', 'WORK', 'OTHER');

-- CreateEnum
CREATE TYPE "PrescriptionStatus" AS ENUM ('UPLOADED', 'AI_PRECHECK', 'UNDER_REVIEW', 'CLARIFICATION_NEEDED', 'APPROVED', 'REJECTED', 'EXPIRED', 'CONSUMED');

-- CreateEnum
CREATE TYPE "FulfilmentType" AS ENUM ('DELIVERY', 'PICKUP');

-- CreateEnum
CREATE TYPE "OrderChannel" AS ENUM ('LOCAL_APP', 'LOCAL_WEB', 'WHATSAPP', 'PARTNER_MANUAL', 'ADMIN');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'AWAITING_RX_REVIEW', 'PLACED', 'ACCEPTED', 'PREPARING', 'READY_SOON', 'READY', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'ARRIVED', 'DELIVERED', 'COMPLETED', 'REJECTED', 'CANCELLED', 'DELIVERY_FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('UPI', 'CARD', 'NETBANKING', 'WALLET', 'COD', 'UPI_LINK');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUND_PENDING', 'REFUNDED', 'COD_PENDING', 'COD_COLLECTED');

-- CreateEnum
CREATE TYPE "SlotType" AS ENUM ('INSTANT', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('RAZORPAY', 'COD', 'UPI_LINK');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('INITIATED', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "DeliverySource" AS ENUM ('LOCAL', 'ONE');

-- CreateEnum
CREATE TYPE "DeliveryTaskStatus" AS ENUM ('CREATED', 'SEARCHING_RIDER', 'ASSIGNED', 'EN_ROUTE_TO_PICKUP', 'ARRIVED_AT_PICKUP', 'WAITING_AT_PICKUP', 'PICKED_UP', 'EN_ROUTE_TO_DROP', 'ARRIVED_AT_DROP', 'DELIVERED', 'FAILED', 'CANCELLED', 'RETURNED_TO_STORE');

-- CreateEnum
CREATE TYPE "RiderStatus" AS ENUM ('ONBOARDING', 'ACTIVE', 'OFFLINE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "SlaType" AS ENUM ('PREP', 'PICKUP', 'DELIVERY');

-- CreateEnum
CREATE TYPE "SlaStatus" AS ENUM ('WITHIN', 'SOFT_BREACH', 'HARD_BREACH');

-- CreateEnum
CREATE TYPE "IncidentType" AS ENUM ('I01_KITCHEN_DELAY', 'I02_ORDER_NOT_READY', 'I03_RIDER_LATE', 'I04_RIDER_WAITED_TOO_LONG', 'I05_INCORRECT_ETA', 'I06_FORCE_MAJEURE', 'I07_ADMIN_OVERRIDE_DELAY', 'I08_CUSTOMER_UNRESPONSIVE', 'I09_READY_SOON_EXPIRED', 'I10_ITEM_UNAVAILABLE');

-- CreateEnum
CREATE TYPE "LiableParty" AS ENUM ('STORE', 'PLATFORM', 'RIDER', 'CUSTOMER', 'NONE');

-- CreateEnum
CREATE TYPE "PenaltyStatus" AS ENUM ('PROPOSED', 'APPLIED', 'WAIVED', 'DISPUTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AdminActionType" AS ENUM ('SEND_WARNING', 'SUGGEST_ETA_INCREASE', 'ASSIGN_PRIORITY_RIDER', 'THROTTLE_ORDERS', 'PAUSE_NEW_ORDERS', 'RESUME_ORDERS', 'DISABLE_COMPLEX_ITEMS', 'FORCE_ETA_OVERRIDE', 'APPROVE_STORE', 'REJECT_STORE', 'SUSPEND_STORE', 'WAIVE_PENALTY', 'CALL_STORE');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('SALE', 'COMMISSION', 'PENALTY', 'PENALTY_REVERSAL', 'REFUND', 'ADJUSTMENT', 'PAYOUT', 'COD_COLLECTED', 'PROMO_FUNDED');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('PENDING', 'APPROVED', 'PROCESSING', 'PAID', 'FAILED', 'ON_HOLD');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_ON_USER', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('PUSH', 'SMS', 'WHATSAPP', 'EMAIL', 'IN_APP');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "WaContextType" AS ENUM ('PARTNER_ONBOARDING', 'CUSTOMER_ORDERING', 'SUPPORT', 'NOTIFICATION');

-- CreateTable
CREATE TABLE "outbox" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flags" (
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "cityIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "storeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "phoneVerified" BOOLEAN NOT NULL DEFAULT false,
    "email" TEXT,
    "fullName" TEXT,
    "avatarUrl" TEXT,
    "language" "Language" NOT NULL DEFAULT 'EN',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_requests" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'SMS',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "app" "AppId" NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "deviceInfo" JSONB,
    "ip" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "app" "AppId" NOT NULL,
    "platform" "DevicePlatform" NOT NULL,
    "token" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL,
    "cityIds" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cities" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "centerLat" DOUBLE PRECISION NOT NULL,
    "centerLng" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "cities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zones" (
    "id" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "polygon" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pincodes" (
    "code" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "zoneId" TEXT,
    "serviceable" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "pincodes_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "state_drug_rules" (
    "id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "codAllowedForRx" BOOLEAN NOT NULL DEFAULT false,
    "scheduleHRequiresRx" BOOLEAN NOT NULL DEFAULT true,
    "scheduleH1RequiresRx" BOOLEAN NOT NULL DEFAULT true,
    "scheduleXAllowed" BOOLEAN NOT NULL DEFAULT false,
    "rxValidityDays" INTEGER NOT NULL DEFAULT 180,
    "legalRiderDocId" TEXT,
    "notes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "state_drug_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_accounts" (
    "id" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "partnerType" "PartnerType" NOT NULL DEFAULT 'PROPRIETORSHIP',
    "gstin" TEXT,
    "pan" TEXT,
    "contactPhone" TEXT NOT NULL,
    "contactEmail" TEXT,
    "whatsappPhone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_members" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "partnerAccountId" TEXT NOT NULL,
    "role" "PartnerRole" NOT NULL,
    "storeIds" TEXT[],
    "invitedByUserId" TEXT,
    "pinHash" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stores" (
    "id" TEXT NOT NULL,
    "partnerAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "vertical" "Vertical" NOT NULL,
    "storeType" "StoreType" NOT NULL,
    "cuisines" TEXT[],
    "description" TEXT,
    "logoUrl" TEXT,
    "coverUrl" TEXT,
    "phone" TEXT,
    "whatsappPhone" TEXT,
    "email" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "landmark" TEXT,
    "pincode" TEXT,
    "cityId" TEXT,
    "zoneId" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "geohash" TEXT,
    "addressConfidence" TEXT,
    "landmarkPhotoUrl" TEXT,
    "status" "StoreStatus" NOT NULL DEFAULT 'DRAFT',
    "openState" "StoreOpenState" NOT NULL DEFAULT 'CLOSED',
    "closedReason" TEXT,
    "readinessScore" INTEGER NOT NULL DEFAULT 0,
    "probationOrdersLeft" INTEGER NOT NULL DEFAULT 100,
    "probationEndsAt" TIMESTAMP(3),
    "liveAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "supportsDelivery" BOOLEAN NOT NULL DEFAULT true,
    "supportsPickup" BOOLEAN NOT NULL DEFAULT true,
    "deliveryRadiusKm" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "expressEnabled" BOOLEAN NOT NULL DEFAULT true,
    "defaultPrepMinutes" INTEGER NOT NULL DEFAULT 25,
    "peakPrepMinutes" INTEGER NOT NULL DEFAULT 35,
    "aiPrepEnabled" BOOLEAN NOT NULL DEFAULT true,
    "aiAlertsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "aiAutoExtendEta" BOOLEAN NOT NULL DEFAULT false,
    "aiMenuAutoPause" BOOLEAN NOT NULL DEFAULT false,
    "aiAggressiveness" INTEGER NOT NULL DEFAULT 50,
    "acceptMultipleOrders" BOOLEAN NOT NULL DEFAULT true,
    "allowSubstitutions" BOOLEAN NOT NULL DEFAULT false,
    "maxOrdersPerHour" INTEGER,
    "autoPauseOverloaded" BOOLEAN NOT NULL DEFAULT true,
    "autoAcceptOrders" BOOLEAN NOT NULL DEFAULT false,
    "minOrderAmount" INTEGER NOT NULL DEFAULT 0,
    "packagingFee" INTEGER NOT NULL DEFAULT 0,
    "avgRating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "allowGenericSubstitution" BOOLEAN NOT NULL DEFAULT false,
    "contactIfRxUnclear" BOOLEAN NOT NULL DEFAULT true,
    "selfPackagingConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "commissionPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "settlementCycle" TEXT NOT NULL DEFAULT 'WEEKLY',
    "deliveryFeeBearer" TEXT NOT NULL DEFAULT 'CUSTOMER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_timings" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "opensAt" TEXT NOT NULL,
    "closesAt" TEXT NOT NULL,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "store_timings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_holidays" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "reason" TEXT,

    CONSTRAINT "store_holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_sessions" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "channel" "OnboardingChannel" NOT NULL,
    "status" "OnboardingStatus" NOT NULL DEFAULT 'DRAFT',
    "currentStep" TEXT NOT NULL,
    "completedSteps" TEXT[],
    "stepData" JSONB NOT NULL,
    "flowVersion" TEXT NOT NULL,
    "referralCode" TEXT,
    "salesAgentId" TEXT,
    "entryPoint" TEXT,
    "trainingDone" BOOLEAN NOT NULL DEFAULT false,
    "quizScore" INTEGER,
    "testOrderDone" BOOLEAN NOT NULL DEFAULT false,
    "readinessBreakdown" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_events" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_documents" (
    "id" TEXT NOT NULL,
    "partnerAccountId" TEXT,
    "storeId" TEXT,
    "type" "DocumentType" NOT NULL,
    "documentNumber" TEXT,
    "fileUrl" TEXT NOT NULL,
    "fileHash" TEXT,
    "issuedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "ocrData" JSONB,
    "nameMatchScore" DOUBLE PRECISION,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "uploadedVia" "OnboardingChannel" NOT NULL DEFAULT 'WEB',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" TEXT NOT NULL,
    "partnerAccountId" TEXT NOT NULL,
    "accountHolderName" TEXT NOT NULL,
    "accountNumberEnc" TEXT NOT NULL,
    "accountNumberLast4" TEXT NOT NULL,
    "ifsc" TEXT NOT NULL,
    "bankName" TEXT,
    "upiId" TEXT,
    "verificationStatus" "BankVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "pennyDropRef" TEXT,
    "nameMatchScore" DOUBLE PRECISION,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pharmacists" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "registrationNo" TEXT NOT NULL,
    "stateCouncil" TEXT NOT NULL,
    "certificateDocId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "consentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pharmacists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pharmacist_shifts" (
    "id" TEXT NOT NULL,
    "pharmacistId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startsAt" TEXT NOT NULL,
    "endsAt" TEXT NOT NULL,

    CONSTRAINT "pharmacist_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_document_versions" (
    "id" TEXT NOT NULL,
    "type" "LegalDocType" NOT NULL,
    "version" TEXT NOT NULL,
    "state" TEXT,
    "vertical" "Vertical",
    "contentUrl" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "legal_document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_records" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "legalDocId" TEXT NOT NULL,
    "storeId" TEXT,
    "orderId" TEXT,
    "channel" "OnboardingChannel" NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "categoryId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "images" TEXT[],
    "sku" TEXT,
    "barcode" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'piece',
    "unitSize" DOUBLE PRECISION,
    "price" INTEGER NOT NULL,
    "mrp" INTEGER,
    "taxRatePct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hsnCode" TEXT,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "pausedUntil" TIMESTAMP(3),
    "isComplex" BOOLEAN NOT NULL DEFAULT false,
    "prepMinutes" INTEGER,
    "maxQtyPerOrder" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isVeg" BOOLEAN,
    "spiceLevel" INTEGER,
    "prescriptionRequired" BOOLEAN NOT NULL DEFAULT false,
    "drugSchedule" "DrugSchedule" NOT NULL DEFAULT 'NONE',
    "saltComposition" TEXT,
    "manufacturer" TEXT,
    "substitutionAllowed" BOOLEAN NOT NULL DEFAULT false,
    "tags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceDiff" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_addon_groups" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "minSelect" INTEGER NOT NULL DEFAULT 0,
    "maxSelect" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "product_addon_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_addons" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" INTEGER NOT NULL DEFAULT 0,
    "isVeg" BOOLEAN,

    CONSTRAINT "product_addons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "trackStock" BOOLEAN NOT NULL DEFAULT true,
    "stockQty" INTEGER NOT NULL DEFAULT 0,
    "reservedQty" INTEGER NOT NULL DEFAULT 0,
    "lowStockThreshold" INTEGER NOT NULL DEFAULT 5,
    "batchNo" TEXT,
    "expiryDate" DATE,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" TEXT NOT NULL,
    "inventoryId" TEXT NOT NULL,
    "type" "InventoryMovementType" NOT NULL,
    "qtyDelta" INTEGER NOT NULL,
    "orderId" TEXT,
    "note" TEXT,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "defaultAddressId" TEXT,
    "referralCode" TEXT,
    "marketingOptIn" BOOLEAN NOT NULL DEFAULT false,
    "whatsappOptIn" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addresses" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" "AddressLabel" NOT NULL DEFAULT 'HOME',
    "contactName" TEXT,
    "contactPhone" TEXT,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "landmark" TEXT,
    "pincode" TEXT NOT NULL,
    "cityName" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "placeId" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carts" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "prescriptionId" TEXT,
    "couponCode" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_items" (
    "id" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "addonIds" TEXT[],
    "qty" INTEGER NOT NULL,
    "isRx" BOOLEAN NOT NULL DEFAULT false,
    "rxItemId" TEXT,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescriptions" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "storeId" TEXT,
    "fileUrls" TEXT[],
    "fileHash" TEXT NOT NULL,
    "status" "PrescriptionStatus" NOT NULL DEFAULT 'UPLOADED',
    "doctorName" TEXT,
    "doctorRegNo" TEXT,
    "patientName" TEXT,
    "issuedOn" DATE,
    "validUntil" DATE,
    "aiPrecheck" JSONB,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "rejectionReason" TEXT,
    "refillsAllowed" INTEGER NOT NULL DEFAULT 0,
    "refillsUsed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prescriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescription_items" (
    "id" TEXT NOT NULL,
    "prescriptionId" TEXT NOT NULL,
    "medicineName" TEXT NOT NULL,
    "dosage" TEXT,
    "productId" TEXT,
    "allowedQty" INTEGER NOT NULL,
    "substitutedWithProductId" TEXT,
    "isApproved" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,

    CONSTRAINT "prescription_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "vertical" "Vertical" NOT NULL,
    "channel" "OrderChannel" NOT NULL,
    "fulfilmentType" "FulfilmentType" NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "slotType" "SlotType" NOT NULL DEFAULT 'INSTANT',
    "scheduledFor" TIMESTAMP(3),
    "addressId" TEXT,
    "deliveryAddress" JSONB,
    "deliveryDistanceKm" DOUBLE PRECISION,
    "itemsSubtotal" INTEGER NOT NULL,
    "discountAmount" INTEGER NOT NULL DEFAULT 0,
    "couponCode" TEXT,
    "deliveryFee" INTEGER NOT NULL DEFAULT 0,
    "packagingFee" INTEGER NOT NULL DEFAULT 0,
    "handlingFee" INTEGER NOT NULL DEFAULT 0,
    "taxAmount" INTEGER NOT NULL DEFAULT 0,
    "tipAmount" INTEGER NOT NULL DEFAULT 0,
    "grandTotal" INTEGER NOT NULL,
    "paymentMode" "PaymentMode" NOT NULL,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "prescriptionId" TEXT,
    "rxDeclarationConsentId" TEXT,
    "promisedPrepMinutes" INTEGER,
    "aiPrepMinutes" INTEGER,
    "aiConfidence" DOUBLE PRECISION,
    "promisedDeliveryAt" TIMESTAMP(3),
    "currentEtaAt" TIMESTAMP(3),
    "placedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "preparingAt" TIMESTAMP(3),
    "readySoonAt" TIMESTAMP(3),
    "readySoonWindowMin" INTEGER,
    "readyAt" TIMESTAMP(3),
    "pickedUpAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "cancelReason" TEXT,
    "rejectReason" TEXT,
    "handoverOtp" TEXT,
    "deliveryOtp" TEXT,
    "pickupOtp" TEXT,
    "customerNote" TEXT,
    "isPriority" BOOLEAN NOT NULL DEFAULT false,
    "isTestOrder" BOOLEAN NOT NULL DEFAULT false,
    "batchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "variantName" TEXT,
    "addons" JSONB,
    "unitPrice" INTEGER NOT NULL,
    "qty" INTEGER NOT NULL,
    "taxRatePct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lineTotal" INTEGER NOT NULL,
    "isRx" BOOLEAN NOT NULL DEFAULT false,
    "rxItemId" TEXT,
    "substitutedProductId" TEXT,
    "isOutOfStock" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_status_events" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "fromState" "OrderStatus",
    "toState" "OrderStatus" NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "reason" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "providerOrderId" TEXT,
    "providerPaymentId" TEXT,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "method" "PaymentMode" NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "paymentLinkUrl" TEXT,
    "capturedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentId" TEXT,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'INITIATED',
    "providerRefundId" TEXT,
    "initiatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupons" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "discountType" TEXT NOT NULL,
    "discountValue" INTEGER NOT NULL,
    "maxDiscount" INTEGER,
    "minOrder" INTEGER NOT NULL DEFAULT 0,
    "vertical" "Vertical",
    "storeId" TEXT,
    "fundedBy" TEXT NOT NULL DEFAULT 'PLATFORM',
    "usageLimit" INTEGER,
    "perUserLimit" INTEGER NOT NULL DEFAULT 1,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_redemptions" (
    "id" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_tasks" (
    "id" TEXT NOT NULL,
    "source" "DeliverySource" NOT NULL DEFAULT 'LOCAL',
    "orderId" TEXT,
    "externalRef" TEXT,
    "status" "DeliveryTaskStatus" NOT NULL DEFAULT 'CREATED',
    "riderId" TEXT,
    "batchId" TEXT,
    "sequenceInBatch" INTEGER,
    "pickupLat" DOUBLE PRECISION NOT NULL,
    "pickupLng" DOUBLE PRECISION NOT NULL,
    "pickupAddress" JSONB NOT NULL,
    "pickupContactPhone" TEXT NOT NULL,
    "dropLat" DOUBLE PRECISION NOT NULL,
    "dropLng" DOUBLE PRECISION NOT NULL,
    "dropAddress" JSONB NOT NULL,
    "dropContactPhone" TEXT NOT NULL,
    "distanceKm" DOUBLE PRECISION,
    "readyAtEstimate" TIMESTAMP(3),
    "etaToPickupMin" INTEGER,
    "etaToDropMin" INTEGER,
    "searchStartedAt" TIMESTAMP(3),
    "assignedAt" TIMESTAMP(3),
    "arrivedPickupAt" TIMESTAMP(3),
    "waitingStartedAt" TIMESTAMP(3),
    "waitingFreeMinutes" INTEGER NOT NULL DEFAULT 10,
    "waitingBilledMin" INTEGER NOT NULL DEFAULT 0,
    "pickedUpAt" TIMESTAMP(3),
    "arrivedDropAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "failedReason" TEXT,
    "handoverVerifiedBy" TEXT,
    "proofType" TEXT,
    "proofUrl" TEXT,
    "riderEarning" INTEGER,
    "codToCollect" INTEGER NOT NULL DEFAULT 0,
    "codCollected" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_task_events" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "fromState" "DeliveryTaskStatus",
    "toState" "DeliveryTaskStatus" NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "actorType" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_task_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_batches" (
    "id" TEXT NOT NULL,
    "riderId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "riders" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "riderCode" TEXT NOT NULL,
    "status" "RiderStatus" NOT NULL DEFAULT 'ONBOARDING',
    "vehicleType" TEXT,
    "cityId" TEXT,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "lastLat" DOUBLE PRECISION,
    "lastLng" DOUBLE PRECISION,
    "lastSeenAt" TIMESTAMP(3),
    "avgRating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "riders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_records" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "slaType" "SlaType" NOT NULL,
    "promisedAt" TIMESTAMP(3) NOT NULL,
    "actualAt" TIMESTAMP(3),
    "breachMinutes" INTEGER NOT NULL DEFAULT 0,
    "status" "SlaStatus" NOT NULL DEFAULT 'WITHIN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sla_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "type" "IncidentType" NOT NULL,
    "detectedBy" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "liableParty" "LiableParty" NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "evidence" JSONB,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "penalties" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "ruleCode" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "liableParty" "LiableParty" NOT NULL,
    "status" "PenaltyStatus" NOT NULL DEFAULT 'PROPOSED',
    "reason" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "dailyCapApplied" BOOLEAN NOT NULL DEFAULT false,
    "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),
    "waivedAt" TIMESTAMP(3),
    "waivedByAdminId" TEXT,
    "waiverReason" TEXT,
    "settlementLineId" TEXT,

    CONSTRAINT "penalties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "penalty_disputes" (
    "id" TEXT NOT NULL,
    "penaltyId" TEXT NOT NULL,
    "raisedByUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "attachments" TEXT[],
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedByAdminId" TEXT,
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "penalty_disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_saves" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "savedMinutes" INTEGER NOT NULL,
    "savedBy" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sla_saves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_actions" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "storeId" TEXT,
    "orderId" TEXT,
    "type" "AdminActionType" NOT NULL,
    "params" JSONB,
    "impactPreview" JSONB,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_throttles" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "maxOrdersPerMin" INTEGER,
    "pauseNewOrders" BOOLEAN NOT NULL DEFAULT false,
    "disabledProductIds" TEXT[],
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "createdByAdminId" TEXT,

    CONSTRAINT "store_throttles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_predictions" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "orderId" TEXT,
    "type" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "riskLevel" TEXT,
    "features" JSONB NOT NULL,
    "explanation" TEXT[],
    "modelVersion" TEXT NOT NULL,
    "actualValue" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_predictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "orderId" TEXT,
    "type" "LedgerEntryType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlements" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "bankAccountId" TEXT,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "grossSales" INTEGER NOT NULL,
    "commission" INTEGER NOT NULL,
    "penalties" INTEGER NOT NULL,
    "refunds" INTEGER NOT NULL,
    "adjustments" INTEGER NOT NULL,
    "codCollected" INTEGER NOT NULL,
    "netPayable" INTEGER NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'PENDING',
    "approvedById" TEXT,
    "utr" TEXT,
    "paidAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "statementUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_lines" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "orderId" TEXT,
    "type" "LedgerEntryType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "description" TEXT,

    CONSTRAINT "settlement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "tags" TEXT[],
    "reply" TEXT,
    "repliedAt" TIMESTAMP(3),
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" TEXT NOT NULL,
    "raisedByUserId" TEXT NOT NULL,
    "raisedByType" TEXT NOT NULL,
    "orderId" TEXT,
    "category" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "assignedAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_messages" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "senderUserId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "attachments" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "app" "AppId" NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "templateCode" TEXT NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "status" "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "providerMsgId" TEXT,
    "sentAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_conversations" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "contextType" "WaContextType" NOT NULL,
    "storeId" TEXT,
    "userId" TEXT,
    "state" TEXT NOT NULL,
    "stateData" JSONB NOT NULL,
    "language" "Language" NOT NULL DEFAULT 'EN',
    "humanTakeover" BOOLEAN NOT NULL DEFAULT false,
    "assignedAdminId" TEXT,
    "lastInboundAt" TIMESTAMP(3),
    "lastOutboundAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "waMessageId" TEXT,
    "type" TEXT NOT NULL,
    "templateName" TEXT,
    "body" TEXT,
    "payload" JSONB,
    "status" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_catalog_sync" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "metaCatalogId" TEXT NOT NULL,
    "metaProductId" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "syncStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "lastError" TEXT,

    CONSTRAINT "whatsapp_catalog_sync_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorType" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_daily_stats" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "ordersPlaced" INTEGER NOT NULL DEFAULT 0,
    "ordersCompleted" INTEGER NOT NULL DEFAULT 0,
    "ordersCancelled" INTEGER NOT NULL DEFAULT 0,
    "ordersRejected" INTEGER NOT NULL DEFAULT 0,
    "grossSales" INTEGER NOT NULL DEFAULT 0,
    "avgPrepMinutes" DOUBLE PRECISION,
    "onTimePct" DOUBLE PRECISION,
    "slaBreaches" INTEGER NOT NULL DEFAULT 0,
    "penaltiesAmount" INTEGER NOT NULL DEFAULT 0,
    "avgRating" DOUBLE PRECISION,

    CONSTRAINT "store_daily_stats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outbox_publishedAt_createdAt_idx" ON "outbox"("publishedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "otp_requests_phone_purpose_createdAt_idx" ON "otp_requests"("phone", "purpose", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refreshTokenHash_key" ON "sessions"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_app_idx" ON "sessions"("userId", "app");

-- CreateIndex
CREATE UNIQUE INDEX "device_tokens_token_key" ON "device_tokens"("token");

-- CreateIndex
CREATE INDEX "device_tokens_userId_app_idx" ON "device_tokens"("userId", "app");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_userId_key" ON "admin_users"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "cities_name_state_key" ON "cities"("name", "state");

-- CreateIndex
CREATE UNIQUE INDEX "zones_cityId_name_key" ON "zones"("cityId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "state_drug_rules_state_key" ON "state_drug_rules"("state");

-- CreateIndex
CREATE UNIQUE INDEX "partner_members_userId_partnerAccountId_key" ON "partner_members"("userId", "partnerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "stores_slug_key" ON "stores"("slug");

-- CreateIndex
CREATE INDEX "stores_cityId_vertical_status_openState_idx" ON "stores"("cityId", "vertical", "status", "openState");

-- CreateIndex
CREATE INDEX "stores_geohash_idx" ON "stores"("geohash");

-- CreateIndex
CREATE UNIQUE INDEX "store_timings_storeId_dayOfWeek_opensAt_key" ON "store_timings"("storeId", "dayOfWeek", "opensAt");

-- CreateIndex
CREATE UNIQUE INDEX "store_holidays_storeId_date_key" ON "store_holidays"("storeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_sessions_storeId_key" ON "onboarding_sessions"("storeId");

-- CreateIndex
CREATE INDEX "onboarding_sessions_status_channel_idx" ON "onboarding_sessions"("status", "channel");

-- CreateIndex
CREATE INDEX "onboarding_events_sessionId_createdAt_idx" ON "onboarding_events"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "partner_documents_storeId_type_status_idx" ON "partner_documents"("storeId", "type", "status");

-- CreateIndex
CREATE INDEX "partner_documents_expiresAt_idx" ON "partner_documents"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "pharmacists_registrationNo_stateCouncil_key" ON "pharmacists"("registrationNo", "stateCouncil");

-- CreateIndex
CREATE UNIQUE INDEX "legal_document_versions_type_version_state_vertical_key" ON "legal_document_versions"("type", "version", "state", "vertical");

-- CreateIndex
CREATE INDEX "consent_records_userId_legalDocId_idx" ON "consent_records"("userId", "legalDocId");

-- CreateIndex
CREATE INDEX "consent_records_orderId_idx" ON "consent_records"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "categories_storeId_name_key" ON "categories"("storeId", "name");

-- CreateIndex
CREATE INDEX "products_storeId_isAvailable_categoryId_idx" ON "products"("storeId", "isAvailable", "categoryId");

-- CreateIndex
CREATE INDEX "products_name_idx" ON "products"("name");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_productId_key" ON "inventory"("productId");

-- CreateIndex
CREATE INDEX "inventory_movements_inventoryId_createdAt_idx" ON "inventory_movements"("inventoryId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "customers_userId_key" ON "customers"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "customers_referralCode_key" ON "customers"("referralCode");

-- CreateIndex
CREATE INDEX "addresses_userId_idx" ON "addresses"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "carts_customerId_storeId_key" ON "carts"("customerId", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "cart_items_cartId_productId_variantId_key" ON "cart_items"("cartId", "productId", "variantId");

-- CreateIndex
CREATE INDEX "prescriptions_customerId_status_idx" ON "prescriptions"("customerId", "status");

-- CreateIndex
CREATE INDEX "prescriptions_storeId_status_idx" ON "prescriptions"("storeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "orders_orderNumber_key" ON "orders"("orderNumber");

-- CreateIndex
CREATE INDEX "orders_storeId_status_createdAt_idx" ON "orders"("storeId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "orders_customerId_createdAt_idx" ON "orders"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "orders_status_currentEtaAt_idx" ON "orders"("status", "currentEtaAt");

-- CreateIndex
CREATE INDEX "order_items_orderId_idx" ON "order_items"("orderId");

-- CreateIndex
CREATE INDEX "order_status_events_orderId_createdAt_idx" ON "order_status_events"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "payments_providerPaymentId_key" ON "payments"("providerPaymentId");

-- CreateIndex
CREATE INDEX "payments_orderId_idx" ON "payments"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "coupons_code_key" ON "coupons"("code");

-- CreateIndex
CREATE UNIQUE INDEX "coupon_redemptions_orderId_key" ON "coupon_redemptions"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_tasks_orderId_key" ON "delivery_tasks"("orderId");

-- CreateIndex
CREATE INDEX "delivery_tasks_status_riderId_idx" ON "delivery_tasks"("status", "riderId");

-- CreateIndex
CREATE INDEX "delivery_tasks_source_externalRef_idx" ON "delivery_tasks"("source", "externalRef");

-- CreateIndex
CREATE INDEX "delivery_task_events_taskId_createdAt_idx" ON "delivery_task_events"("taskId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "riders_userId_key" ON "riders"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "riders_riderCode_key" ON "riders"("riderCode");

-- CreateIndex
CREATE INDEX "riders_cityId_isOnline_idx" ON "riders"("cityId", "isOnline");

-- CreateIndex
CREATE INDEX "sla_records_storeId_slaType_status_createdAt_idx" ON "sla_records"("storeId", "slaType", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "sla_records_orderId_slaType_key" ON "sla_records"("orderId", "slaType");

-- CreateIndex
CREATE INDEX "incidents_storeId_detectedAt_idx" ON "incidents"("storeId", "detectedAt");

-- CreateIndex
CREATE INDEX "penalties_storeId_status_proposedAt_idx" ON "penalties"("storeId", "status", "proposedAt");

-- CreateIndex
CREATE UNIQUE INDEX "penalty_disputes_penaltyId_key" ON "penalty_disputes"("penaltyId");

-- CreateIndex
CREATE INDEX "admin_actions_storeId_createdAt_idx" ON "admin_actions"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "store_throttles_storeId_endsAt_idx" ON "store_throttles"("storeId", "endsAt");

-- CreateIndex
CREATE INDEX "ai_predictions_storeId_type_createdAt_idx" ON "ai_predictions"("storeId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "ledger_entries_storeId_createdAt_idx" ON "ledger_entries"("storeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "settlements_storeId_periodStart_periodEnd_key" ON "settlements"("storeId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "settlement_lines_settlementId_idx" ON "settlement_lines"("settlementId");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_orderId_key" ON "reviews"("orderId");

-- CreateIndex
CREATE INDEX "reviews_storeId_createdAt_idx" ON "reviews"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "support_tickets_status_priority_idx" ON "support_tickets"("status", "priority");

-- CreateIndex
CREATE INDEX "notifications_userId_app_createdAt_idx" ON "notifications"("userId", "app", "createdAt");

-- CreateIndex
CREATE INDEX "whatsapp_conversations_phone_contextType_idx" ON "whatsapp_conversations"("phone", "contextType");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_messages_waMessageId_key" ON "whatsapp_messages"("waMessageId");

-- CreateIndex
CREATE INDEX "whatsapp_messages_conversationId_createdAt_idx" ON "whatsapp_messages"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_catalog_sync_productId_key" ON "whatsapp_catalog_sync"("productId");

-- CreateIndex
CREATE INDEX "audit_logs_entity_entityId_createdAt_idx" ON "audit_logs"("entity", "entityId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "store_daily_stats_storeId_date_key" ON "store_daily_stats"("storeId", "date");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zones" ADD CONSTRAINT "zones_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pincodes" ADD CONSTRAINT "pincodes_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pincodes" ADD CONSTRAINT "pincodes_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_members" ADD CONSTRAINT "partner_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_members" ADD CONSTRAINT "partner_members_partnerAccountId_fkey" FOREIGN KEY ("partnerAccountId") REFERENCES "partner_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_partnerAccountId_fkey" FOREIGN KEY ("partnerAccountId") REFERENCES "partner_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_timings" ADD CONSTRAINT "store_timings_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_holidays" ADD CONSTRAINT "store_holidays_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_sessions" ADD CONSTRAINT "onboarding_sessions_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_sessions" ADD CONSTRAINT "onboarding_sessions_salesAgentId_fkey" FOREIGN KEY ("salesAgentId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_events" ADD CONSTRAINT "onboarding_events_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "onboarding_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_documents" ADD CONSTRAINT "partner_documents_partnerAccountId_fkey" FOREIGN KEY ("partnerAccountId") REFERENCES "partner_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_documents" ADD CONSTRAINT "partner_documents_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_documents" ADD CONSTRAINT "partner_documents_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_partnerAccountId_fkey" FOREIGN KEY ("partnerAccountId") REFERENCES "partner_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacists" ADD CONSTRAINT "pharmacists_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacists" ADD CONSTRAINT "pharmacists_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacist_shifts" ADD CONSTRAINT "pharmacist_shifts_pharmacistId_fkey" FOREIGN KEY ("pharmacistId") REFERENCES "pharmacists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_legalDocId_fkey" FOREIGN KEY ("legalDocId") REFERENCES "legal_document_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_addon_groups" ADD CONSTRAINT "product_addon_groups_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_addons" ADD CONSTRAINT "product_addons_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "product_addon_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "inventory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "pharmacists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_items" ADD CONSTRAINT "prescription_items_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "prescriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_items" ADD CONSTRAINT "prescription_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "prescriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_events" ADD CONSTRAINT "order_status_events_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_tasks" ADD CONSTRAINT "delivery_tasks_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_tasks" ADD CONSTRAINT "delivery_tasks_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "riders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_tasks" ADD CONSTRAINT "delivery_tasks_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "delivery_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_task_events" ADD CONSTRAINT "delivery_task_events_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "delivery_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_batches" ADD CONSTRAINT "delivery_batches_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "riders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "riders" ADD CONSTRAINT "riders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_records" ADD CONSTRAINT "sla_records_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_records" ADD CONSTRAINT "sla_records_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "penalties" ADD CONSTRAINT "penalties_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "penalties" ADD CONSTRAINT "penalties_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "penalty_disputes" ADD CONSTRAINT "penalty_disputes_penaltyId_fkey" FOREIGN KEY ("penaltyId") REFERENCES "penalties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_saves" ADD CONSTRAINT "sla_saves_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_actions" ADD CONSTRAINT "admin_actions_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_actions" ADD CONSTRAINT "admin_actions_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_throttles" ADD CONSTRAINT "store_throttles_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_predictions" ADD CONSTRAINT "ai_predictions_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_predictions" ADD CONSTRAINT "ai_predictions_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_raisedByUserId_fkey" FOREIGN KEY ("raisedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "whatsapp_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_catalog_sync" ADD CONSTRAINT "whatsapp_catalog_sync_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_catalog_sync" ADD CONSTRAINT "whatsapp_catalog_sync_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_daily_stats" ADD CONSTRAINT "store_daily_stats_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
