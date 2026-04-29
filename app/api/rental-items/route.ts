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
  imageUrl: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

type RentalCatalogItemInput = {
  damageFee: number;
  imageUrl: string;
  maxHours: number;
  maxQuantity: number;
  name: string;
  price: number;
};

type RentalCatalogItemMutationBody = Partial<RentalCatalogItemInput> & {
  id?: string;
};

export async function GET() {
  try {
    const items = await getCatalogItems();

    return NextResponse.json(items);
  } catch (error) {
    console.error("Unable to load rental items from the database.", error);
    return NextResponse.json(
      { message: "Unable to load rental items from the database." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const input = parseRentalCatalogItemInput(await request.json());
    const prisma = getPrisma();
    const id = await buildCatalogItemId(input.name);
    const sortOrder =
      ((await prisma.rentalCatalogItem.aggregate({
        _max: { sortOrder: true },
      }))._max.sortOrder ?? 0) + 1;

    await prisma.rentalCatalogItem.create({
      data: {
        ...input,
        id,
        isActive: true,
        sortOrder,
      },
    });

    return NextResponse.json(await getCatalogItems(), { status: 201 });
  } catch (error) {
    return handleRentalCatalogMutationError(
      error,
      "Unable to create rental item.",
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as RentalCatalogItemMutationBody;
    const id = typeof body.id === "string" ? body.id.trim() : "";

    if (!id) {
      return NextResponse.json(
        { message: "Rental item id is required." },
        { status: 400 },
      );
    }

    const input = parseRentalCatalogItemInput(body);

    await getPrisma().rentalCatalogItem.update({
      where: { id },
      data: input,
    });

    return NextResponse.json(await getCatalogItems());
  } catch (error) {
    return handleRentalCatalogMutationError(
      error,
      "Unable to update rental item.",
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json()) as RentalCatalogItemMutationBody;
    const id = typeof body.id === "string" ? body.id.trim() : "";

    if (!id) {
      return NextResponse.json(
        { message: "Rental item id is required." },
        { status: 400 },
      );
    }

    await getPrisma().rentalCatalogItem.update({
      where: { id },
      data: { isActive: false },
    });

    return NextResponse.json(await getCatalogItems());
  } catch (error) {
    return handleRentalCatalogMutationError(
      error,
      "Unable to delete rental item.",
    );
  }
}

async function getCatalogItems() {
  return getPrisma().$queryRaw<RentalCatalogItemRow[]>`
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
}

function parseRentalCatalogItemInput(
  rawBody: unknown,
): RentalCatalogItemInput {
  const body = (rawBody ?? {}) as RentalCatalogItemMutationBody;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const imageUrl =
    typeof body.imageUrl === "string" ? body.imageUrl.trim() : "";

  if (!name) {
    throw new Error("Item name is required.");
  }

  if (!imageUrl) {
    throw new Error("Image URL is required.");
  }

  return {
    damageFee: parseWholeNumber(body.damageFee, "Damage fee"),
    imageUrl,
    maxHours: parsePositiveNumber(body.maxHours, "Max hours"),
    maxQuantity: parsePositiveNumber(body.maxQuantity, "Stock quantity"),
    name,
    price: parseWholeNumber(body.price, "Rental rate"),
  };
}

function parseWholeNumber(value: unknown, label: string) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
    throw new Error(`${label} must be a whole number of 0 or more.`);
  }

  return parsed;
}

function parsePositiveNumber(value: unknown, label: string) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 1 || !Number.isInteger(parsed)) {
    throw new Error(`${label} must be a whole number of at least 1.`);
  }

  return parsed;
}

async function buildCatalogItemId(name: string) {
  const prisma = getPrisma();
  const baseId =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "rental-item";

  const existing = await prisma.rentalCatalogItem.findUnique({
    where: { id: baseId },
    select: { id: true },
  });

  if (!existing) {
    return baseId;
  }

  return `${baseId}-${crypto.randomUUID().slice(0, 6)}`;
}

function handleRentalCatalogMutationError(
  error: unknown,
  fallbackMessage: string,
) {
  console.error(fallbackMessage, error);

  if (error instanceof Error) {
    return NextResponse.json({ message: error.message }, { status: 400 });
  }

  return NextResponse.json({ message: fallbackMessage }, { status: 500 });
}
