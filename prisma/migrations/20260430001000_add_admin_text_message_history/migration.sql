CREATE TABLE "AdminTextMessage" (
    "id" TEXT NOT NULL,
    "rentalId" TEXT,
    "customerName" TEXT NOT NULL DEFAULT '',
    "mobile" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminTextMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdminTextMessage_createdAt_idx" ON "AdminTextMessage"("createdAt");
CREATE INDEX "AdminTextMessage_rentalId_createdAt_idx" ON "AdminTextMessage"("rentalId", "createdAt");
