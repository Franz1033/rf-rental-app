CREATE TABLE "Rental" (
    "id" TEXT NOT NULL,
    "floatId" TEXT NOT NULL,
    "floatName" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "customerName" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "verificationCode" TEXT NOT NULL,
    "paymentMode" TEXT NOT NULL,
    "amountDue" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "smsSentAt" TIMESTAMP(3),
    "durationMinutes" INTEGER NOT NULL,

    CONSTRAINT "Rental_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RentalItem" (
    "id" TEXT NOT NULL,
    "rentalId" TEXT NOT NULL,
    "floatId" TEXT NOT NULL,
    "floatName" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "subtotal" INTEGER NOT NULL,

    CONSTRAINT "RentalItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Rental_mobile_paymentMode_status_createdAt_idx" ON "Rental"("mobile", "paymentMode", "status", "createdAt");
CREATE INDEX "Rental_status_createdAt_idx" ON "Rental"("status", "createdAt");
CREATE INDEX "RentalItem_rentalId_idx" ON "RentalItem"("rentalId");

ALTER TABLE "RentalItem" ADD CONSTRAINT "RentalItem_rentalId_fkey" FOREIGN KEY ("rentalId") REFERENCES "Rental"("id") ON DELETE CASCADE ON UPDATE CASCADE;
