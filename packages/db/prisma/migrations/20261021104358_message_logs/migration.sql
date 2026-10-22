-- CreateTable
CREATE TABLE "message_logs" (
    "id" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "toPhone" TEXT NOT NULL,
    "userId" TEXT,
    "templateCode" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "providerMsgId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "message_logs_toPhone_createdAt_idx" ON "message_logs"("toPhone", "createdAt");

-- CreateIndex
CREATE INDEX "message_logs_createdAt_idx" ON "message_logs"("createdAt");
