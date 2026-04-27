import { NextResponse } from "next/server";
import { getPrisma } from "@/app/lib/prisma";

export const dynamic = "force-dynamic";

type RentalCatalogItemRow = {
  id: string;
  name: string;
  price: number;
  damageFee: number;
  maxHours: number;
  maxQuantity: number;
  availableQuantity: number;
  accent: string;
  imageUrl: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

export async function GET() {
  try {
    const items = await getPrisma().$queryRaw<RentalCatalogItemRow[]>`
      SELECT
        catalog."id",
        catalog."name",
        catalog."price",
        catalog."damageFee",
        catalog."maxHours",
        catalog."maxQuantity",
        GREATEST(
          catalog."maxQuantity" - COALESCE(open_items."reservedQuantity", 0),
          0
        )::int AS "availableQuantity",
        catalog."accent",
        catalog."imageUrl",
        catalog."isActive",
        catalog."sortOrder",
        catalog."createdAt",
        catalog."updatedAt"
      FROM "RentalCatalogItem" catalog
      LEFT JOIN (
        SELECT
          item."floatId",
          COALESCE(SUM(item."quantity"), 0)::int AS "reservedQuantity"
        FROM "RentalItem" item
        INNER JOIN "Rental" rental
          ON rental."id" = item."rentalId"
        WHERE item."returnedAt" IS NULL
          AND rental."status" = 'active'
        GROUP BY item."floatId"
      ) open_items
        ON open_items."floatId" = catalog."id"
      WHERE catalog."isActive" = true
      ORDER BY catalog."sortOrder" ASC, catalog."name" ASC
    `;

    return NextResponse.json(items);
  } catch (error) {
    console.error("Unable to load rental items from the database.", error);
    return NextResponse.json(
      { message: "Unable to load rental items from the database." },
      { status: 500 },
    );
  }
}
