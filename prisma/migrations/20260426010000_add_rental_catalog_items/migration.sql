CREATE TABLE "RentalCatalogItem" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "damageFee" INTEGER NOT NULL,
    "accent" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RentalCatalogItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RentalCatalogItem_isActive_sortOrder_name_idx" ON "RentalCatalogItem"("isActive", "sortOrder", "name");
