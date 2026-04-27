import { NextResponse } from "next/server";
import { Client } from "pg";
import type { RentalRecord } from "@/app/rental-data";
import { pendingRentalExpirationMs } from "@/app/lib/rental-config";

const freeRentalCooldownMs = 24 * 60 * 60 * 1000;

export const dynamic = "force-dynamic";

type RentalRow = {
  id: string;
  floatId: string;
  floatName: string;
  price: number;
  customerName: string;
  mobile: string;
  verificationCode: string;
  paymentMode: string;
  amountDue: number;
  status: string;
  createdAt: Date;
  activatedAt: Date | null;
  returnedAt: Date | null;
  cancelledAt: Date | null;
  smsSentAt: Date | null;
  durationMinutes: number;
  items: Array<{
    id: string;
    floatId: string;
    floatName: string;
    price: number;
    quantity: number;
    durationMinutes: number;
    subtotal: number;
    returnedAt: Date | null;
  }>;
};

type CatalogStockRow = {
  id: string;
  isActive: boolean;
  maxQuantity: number;
  name: string;
};

type ExistingRentalStateRow = {
  id: string;
  status: string;
  activatedAt: Date | null;
  returnedAt: Date | null;
  cancelledAt: Date | null;
};

export async function GET() {
  const client = createClient();

  try {
    await client.connect();
    await expireStalePendingRentals(client);
    const rentals = await getRentalsFromDb(client);

    return NextResponse.json(rentals.map(toRentalRecord));
  } catch (error) {
    console.error("Unable to load rentals from the database.", error);
    return NextResponse.json(
      { message: "Unable to load rentals from the database." },
      { status: 500 },
    );
  } finally {
    await client.end().catch(() => {});
  }
}

export async function POST(request: Request) {
  const client = createClient();

  try {
    await client.connect();
    await expireStalePendingRentals(client);
    await client.query("BEGIN");

    const rental = expirePendingRentalRecord((await request.json()) as RentalRecord);
    const cooldownMessage = await getFreeCooldownMessage(client, rental);

    if (cooldownMessage) {
      await client.query("ROLLBACK");
      return NextResponse.json({ message: cooldownMessage }, { status: 409 });
    }

    const availabilityMessage = await getAvailabilityMessageForRental(
      client,
      rental,
    );

    if (availabilityMessage) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { message: availabilityMessage },
        { status: 409 },
      );
    }

    const savedRental = await persistRental(client, rental);
    await client.query("COMMIT");

    return NextResponse.json(toRentalRecord(savedRental), { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Unable to save this rental to the database.", error);
    return NextResponse.json(
      { message: "Unable to save this rental to the database." },
      { status: 500 },
    );
  } finally {
    await client.end().catch(() => {});
  }
}

export async function PUT(request: Request) {
  const client = createClient();

  try {
    await client.connect();
    await expireStalePendingRentals(client);

    const rentals = ((await request.json()) as RentalRecord[]).map(
      expirePendingRentalRecord,
    );
    const existingStates = await getExistingRentalStates(client, rentals);
    const normalizedRentals = rentals.map((rental) =>
      preserveTerminalRentalState(rental, existingStates.get(rental.id)),
    );
    await client.query("BEGIN");

    const availabilityMessage = await getAvailabilityMessageForRentals(
      client,
      normalizedRentals,
    );

    if (availabilityMessage) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { message: availabilityMessage },
        { status: 409 },
      );
    }

    const savedRentals: RentalRow[] = [];
    for (const rental of normalizedRentals) {
      savedRentals.push(await persistRental(client, rental));
    }

    await client.query("COMMIT");
    return NextResponse.json(savedRentals.map(toRentalRecord));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Unable to update rentals in the database.", error);
    return NextResponse.json(
      { message: "Unable to update rentals in the database." },
      { status: 500 },
    );
  } finally {
    await client.end().catch(() => {});
  }
}

function createClient() {
  const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DIRECT_URL or DATABASE_URL is required.");
  }

  return new Client({ connectionString });
}

async function getRentalsFromDb(client: Client) {
  const result = await client.query<RentalRow>(`
    SELECT
      r."id",
      r."floatId",
      r."floatName",
      r."price",
      r."customerName",
      r."mobile",
      r."verificationCode",
      r."paymentMode",
      r."amountDue",
      r."status",
      r."createdAt",
      r."activatedAt",
      r."returnedAt",
      r."cancelledAt",
      r."smsSentAt",
      r."durationMinutes",
      COALESCE(
        json_agg(
          json_build_object(
            'id', i."id",
            'floatId', i."floatId",
            'floatName', i."floatName",
            'price', i."price",
            'quantity', i."quantity",
            'durationMinutes', i."durationMinutes",
            'subtotal', i."subtotal",
            'returnedAt', i."returnedAt"
          )
          ORDER BY i."id"
        ) FILTER (WHERE i."id" IS NOT NULL),
        '[]'::json
      ) AS "items"
    FROM "Rental" r
    LEFT JOIN "RentalItem" i ON i."rentalId" = r."id"
    GROUP BY r."id"
    ORDER BY r."createdAt" DESC
  `);

  return result.rows;
}

async function getFreeCooldownMessage(client: Client, rental: RentalRecord) {
  if (rental.paymentMode !== "Free") {
    return "";
  }

  const cutoff = new Date(Date.now() - freeRentalCooldownMs);
  const result = await client.query<{ createdAt: Date }>(
    `
      SELECT "createdAt"
      FROM "Rental"
      WHERE "mobile" = $1
        AND "paymentMode" = 'Free'
        AND "status" NOT IN ('cancelled', 'expired')
        AND "createdAt" > $2
        AND "id" <> $3
      ORDER BY "createdAt" DESC
      LIMIT 1
    `,
    [rental.mobile, cutoff, rental.id],
  );

  const existingRental = result.rows[0];

  if (!existingRental) {
    return "";
  }

  const nextAllowedAt = existingRental.createdAt.getTime() + freeRentalCooldownMs;

  return `This mobile number already claimed a free 1-hour rental within the last 24 hours. It can claim again after ${new Intl.DateTimeFormat(
    "en-PH",
    {
      hour: "numeric",
      minute: "2-digit",
      month: "short",
      day: "numeric",
    },
  ).format(nextAllowedAt)}.`;
}

async function expireStalePendingRentals(client: Client) {
  const cutoff = new Date(Date.now() - pendingRentalExpirationMs);

  await client.query(
    `
      UPDATE "Rental"
      SET
        "status" = 'expired',
        "cancelledAt" = COALESCE(
          "cancelledAt",
          "createdAt" + ($2 * INTERVAL '1 millisecond')
        )
      WHERE "status" = 'pending'
        AND "createdAt" <= $1
    `,
    [cutoff, pendingRentalExpirationMs],
  );
}

function expirePendingRentalRecord(rental: RentalRecord): RentalRecord {
  if (
    rental.status !== "pending" ||
    rental.createdAt + pendingRentalExpirationMs > Date.now()
  ) {
    return rental;
  }

  return {
    ...rental,
    cancelledAt: rental.cancelledAt ?? rental.createdAt + pendingRentalExpirationMs,
    status: "expired",
  };
}

async function getExistingRentalStates(
  client: Client,
  rentals: RentalRecord[],
) {
  const rentalIds = Array.from(new Set(rentals.map((rental) => rental.id)));

  if (rentalIds.length === 0) {
    return new Map<string, ExistingRentalStateRow>();
  }

  const result = await client.query<ExistingRentalStateRow>(
    `
      SELECT
        "id",
        "status",
        "activatedAt",
        "returnedAt",
        "cancelledAt"
      FROM "Rental"
      WHERE "id" = ANY($1::text[])
    `,
    [rentalIds],
  );

  return new Map(result.rows.map((row) => [row.id, row]));
}

function preserveTerminalRentalState(
  rental: RentalRecord,
  existingRental: ExistingRentalStateRow | undefined,
): RentalRecord {
  if (!existingRental) {
    return rental;
  }

  if (existingRental.status === "returned") {
    return {
      ...rental,
      returnedAt: toTimestamp(existingRental.returnedAt) ?? rental.returnedAt,
      status: "returned",
    };
  }

  if (existingRental.status === "cancelled") {
    return {
      ...rental,
      cancelledAt:
        toTimestamp(existingRental.cancelledAt) ?? rental.cancelledAt,
      status: "cancelled",
    };
  }

  if (existingRental.status === "expired") {
    return {
      ...rental,
      cancelledAt:
        toTimestamp(existingRental.cancelledAt) ?? rental.cancelledAt,
      status: "expired",
    };
  }

  return rental;
}

function getOpenDemandFromRental(rental: RentalRecord) {
  const demand = new Map<string, { name: string; quantity: number }>();

  if (!rentalReservesInventory(rental)) {
    return demand;
  }

  const items =
    rental.items?.length && rental.items.length > 0
      ? rental.items
      : [
          {
            floatId: rental.floatId,
            floatName: rental.floatName,
            quantity: 1,
            returnedAt: rental.returnedAt,
          },
        ];

  for (const item of items) {
    if (item.returnedAt) {
      continue;
    }

    const current = demand.get(item.floatId);

    if (current) {
      current.quantity += item.quantity;
      continue;
    }

    demand.set(item.floatId, {
      name: item.floatName,
      quantity: item.quantity,
    });
  }

  return demand;
}

function rentalReservesInventory(rental: RentalRecord) {
  return rental.status === "pending" || rental.status === "active";
}

function buildAvailabilityMessage(
  itemName: string,
  requestedQuantity: number,
  availableQuantity: number,
) {
  if (availableQuantity <= 0) {
    return `${itemName} is currently unavailable.`;
  }

  const itemLabel = availableQuantity === 1 ? "item" : "items";
  return `Only ${availableQuantity} ${itemLabel} of ${itemName} ${availableQuantity === 1 ? "is" : "are"} available right now, but ${requestedQuantity} ${requestedQuantity === 1 ? "was" : "were"} requested.`;
}

async function getCatalogStockById(client: Client) {
  const result = await client.query<CatalogStockRow>(`
    SELECT
      "id",
      "name",
      "maxQuantity",
      "isActive"
    FROM "RentalCatalogItem"
    FOR UPDATE
  `);

  return new Map(result.rows.map((row) => [row.id, row]));
}

async function getOpenDemandFromDb(client: Client, excludedRentalId?: string) {
  const params: string[] = [];
  let excludeClause = "";

  if (excludedRentalId) {
    params.push(excludedRentalId);
    excludeClause = ` AND rental."id" <> $1`;
  }

  const result = await client.query<{ floatId: string; quantity: number }>(
    `
      SELECT
        item."floatId",
        COALESCE(SUM(item."quantity"), 0)::int AS "quantity"
      FROM "RentalItem" item
      INNER JOIN "Rental" rental
        ON rental."id" = item."rentalId"
      WHERE item."returnedAt" IS NULL
        AND rental."status" IN ('pending', 'active')
        ${excludeClause}
      GROUP BY item."floatId"
    `,
    params,
  );

  return new Map(result.rows.map((row) => [row.floatId, row.quantity]));
}

async function getAvailabilityMessageForRental(
  client: Client,
  rental: RentalRecord,
) {
  const demand = getOpenDemandFromRental(rental);

  if (demand.size === 0) {
    return "";
  }

  const catalog = await getCatalogStockById(client);
  const reserved = await getOpenDemandFromDb(client, rental.id);

  for (const [floatId, itemDemand] of demand) {
    const stock = catalog.get(floatId);

    if (!stock || !stock.isActive) {
      return `${itemDemand.name} is no longer available.`;
    }

    const availableQuantity = Math.max(
      stock.maxQuantity - (reserved.get(floatId) ?? 0),
      0,
    );

    if (itemDemand.quantity > availableQuantity) {
      return buildAvailabilityMessage(
        itemDemand.name,
        itemDemand.quantity,
        availableQuantity,
      );
    }
  }

  return "";
}

async function getAvailabilityMessageForRentals(
  client: Client,
  rentals: RentalRecord[],
) {
  const catalog = await getCatalogStockById(client);
  const demand = new Map<string, { name: string; quantity: number }>();

  for (const rental of rentals) {
    const rentalDemand = getOpenDemandFromRental(rental);

    for (const [floatId, itemDemand] of rentalDemand) {
      const current = demand.get(floatId);

      if (current) {
        current.quantity += itemDemand.quantity;
        continue;
      }

      demand.set(floatId, {
        name: itemDemand.name,
        quantity: itemDemand.quantity,
      });
    }
  }

  for (const [floatId, itemDemand] of demand) {
    const stock = catalog.get(floatId);

    if (!stock || !stock.isActive) {
      return `${itemDemand.name} is no longer available.`;
    }

    if (itemDemand.quantity > stock.maxQuantity) {
      return buildAvailabilityMessage(
        itemDemand.name,
        itemDemand.quantity,
        stock.maxQuantity,
      );
    }
  }

  return "";
}

async function persistRental(client: Client, rental: RentalRecord) {
  const items = (rental.items ?? []).map((item, index) => ({
    id: item.id ?? `${rental.id}-item-${index}`,
    floatId: item.floatId,
    floatName: item.floatName,
    price: item.price,
    quantity: item.quantity,
    durationMinutes: item.durationMinutes,
    subtotal: item.subtotal,
    returnedAt: toDate(item.returnedAt),
  }));

  await client.query(
    `
      INSERT INTO "Rental" (
        "id",
        "floatId",
        "floatName",
        "price",
        "customerName",
        "mobile",
        "verificationCode",
        "paymentMode",
        "amountDue",
        "status",
        "createdAt",
        "activatedAt",
        "returnedAt",
        "cancelledAt",
        "smsSentAt",
        "durationMinutes"
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14, $15, $16
      )
      ON CONFLICT ("id") DO UPDATE SET
        "floatId" = EXCLUDED."floatId",
        "floatName" = EXCLUDED."floatName",
        "price" = EXCLUDED."price",
        "customerName" = EXCLUDED."customerName",
        "mobile" = EXCLUDED."mobile",
        "verificationCode" = EXCLUDED."verificationCode",
        "paymentMode" = EXCLUDED."paymentMode",
        "amountDue" = EXCLUDED."amountDue",
        "status" = EXCLUDED."status",
        "createdAt" = EXCLUDED."createdAt",
        "activatedAt" = EXCLUDED."activatedAt",
        "returnedAt" = EXCLUDED."returnedAt",
        "cancelledAt" = EXCLUDED."cancelledAt",
        "smsSentAt" = EXCLUDED."smsSentAt",
        "durationMinutes" = EXCLUDED."durationMinutes"
    `,
    [
      rental.id,
      rental.floatId,
      rental.floatName,
      rental.price,
      rental.customerName,
      rental.mobile,
      rental.verificationCode,
      rental.paymentMode,
      rental.amountDue,
      rental.status,
      new Date(rental.createdAt),
      toDate(rental.activatedAt),
      toDate(rental.returnedAt),
      toDate(rental.cancelledAt),
      toDate(rental.smsSentAt),
      rental.durationMinutes,
    ],
  );

  await client.query(`DELETE FROM "RentalItem" WHERE "rentalId" = $1`, [rental.id]);

  for (const item of items) {
    await client.query(
      `
        INSERT INTO "RentalItem" (
          "id",
          "rentalId",
          "floatId",
          "floatName",
          "price",
          "quantity",
          "durationMinutes",
          "subtotal",
          "returnedAt"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        item.id,
        rental.id,
        item.floatId,
        item.floatName,
        item.price,
        item.quantity,
        item.durationMinutes,
        item.subtotal,
        item.returnedAt,
      ],
    );
  }

  const [savedRental] = await getRentalById(client, rental.id);

  if (!savedRental) {
    throw new Error(`Unable to reload rental ${rental.id} after save.`);
  }

  return savedRental;
}

async function getRentalById(client: Client, rentalId: string) {
  const result = await client.query<RentalRow>(
    `
      SELECT
        r."id",
        r."floatId",
        r."floatName",
        r."price",
        r."customerName",
        r."mobile",
        r."verificationCode",
        r."paymentMode",
        r."amountDue",
        r."status",
        r."createdAt",
        r."activatedAt",
        r."returnedAt",
        r."cancelledAt",
        r."smsSentAt",
        r."durationMinutes",
        COALESCE(
          json_agg(
            json_build_object(
              'id', i."id",
              'floatId', i."floatId",
              'floatName', i."floatName",
              'price', i."price",
              'quantity', i."quantity",
              'durationMinutes', i."durationMinutes",
              'subtotal', i."subtotal",
              'returnedAt', i."returnedAt"
            )
            ORDER BY i."id"
          ) FILTER (WHERE i."id" IS NOT NULL),
          '[]'::json
        ) AS "items"
      FROM "Rental" r
      LEFT JOIN "RentalItem" i ON i."rentalId" = r."id"
      WHERE r."id" = $1
      GROUP BY r."id"
    `,
    [rentalId],
  );

  return result.rows;
}

function toRentalRecord(rental: RentalRow): RentalRecord {
  return {
    id: rental.id,
    floatId: rental.floatId,
    floatName: rental.floatName,
    price: rental.price,
    items: rental.items.map((item) => ({
      id: item.id,
      floatId: item.floatId,
      floatName: item.floatName,
      price: item.price,
      quantity: item.quantity,
      durationMinutes: item.durationMinutes,
      subtotal: item.subtotal,
      returnedAt: toTimestamp(item.returnedAt),
    })),
    customerName: rental.customerName,
    mobile: rental.mobile,
    verificationCode: rental.verificationCode,
    paymentMode: rental.paymentMode as RentalRecord["paymentMode"],
    amountDue: rental.amountDue,
    status: rental.status as RentalRecord["status"],
    createdAt: rental.createdAt.getTime(),
    activatedAt: toTimestamp(rental.activatedAt),
    returnedAt: toTimestamp(rental.returnedAt),
    cancelledAt: toTimestamp(rental.cancelledAt),
    smsSentAt: toTimestamp(rental.smsSentAt),
    durationMinutes: rental.durationMinutes,
  };
}

function toDate(timestamp?: number) {
  return timestamp ? new Date(timestamp) : null;
}

function toTimestamp(date: Date | string | null) {
  if (!date) {
    return undefined;
  }

  return new Date(date).getTime();
}
