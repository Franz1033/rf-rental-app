import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isAuthenticatedAdmin } from "@/app/lib/admin-auth";
import { getPrisma } from "@/app/lib/prisma";
import { sendSmsMessage } from "@/app/lib/sms";

type TextCustomerRequestBody = {
  customerName?: string;
  message?: string;
  mobile?: string;
  rentalId?: string;
};

type AdminTextMessageRow = {
  id: string;
  rentalId: string | null;
  customerName: string;
  mobile: string;
  message: string;
  createdAt: Date;
};

async function requireAdmin() {
  const cookieStore = await cookies();
  const isAuthenticated = isAuthenticatedAdmin(
    cookieStore.get("rf_admin_session")?.value,
  );

  if (!isAuthenticated) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  return null;
}

function normalizePhilippineMobile(mobile: string) {
  const digits = mobile.replace(/\D/g, "");

  if (digits.startsWith("09") && digits.length === 11) {
    return `+63${digits.slice(1)}`;
  }

  if (digits.startsWith("639") && digits.length === 12) {
    return `+${digits}`;
  }

  return "";
}

export async function GET() {
  const unauthorizedResponse = await requireAdmin();

  if (unauthorizedResponse) {
    return unauthorizedResponse;
  }

  const rows = await getPrisma().$queryRaw<AdminTextMessageRow[]>`
    SELECT
      "id",
      "rentalId",
      "customerName",
      "mobile",
      "message",
      "createdAt"
    FROM "AdminTextMessage"
    ORDER BY "createdAt" DESC
    LIMIT 30
  `;

  return NextResponse.json({
    messages: rows.map((row) => ({
      createdAt: row.createdAt.getTime(),
      customerName: row.customerName,
      id: row.id,
      message: row.message,
      mobile: row.mobile,
      rentalId: row.rentalId,
    })),
  });
}

export async function POST(request: Request) {
  const unauthorizedResponse = await requireAdmin();

  if (unauthorizedResponse) {
    return unauthorizedResponse;
  }

  const body = (await request.json().catch(() => null)) as
    | TextCustomerRequestBody
    | null;
  const customerName = body?.customerName?.trim() ?? "";
  const message = body?.message?.trim() ?? "";
  const normalizedMobile = normalizePhilippineMobile(body?.mobile?.trim() ?? "");
  const rentalId = body?.rentalId?.trim() ?? "";

  if (!normalizedMobile) {
    return NextResponse.json(
      {
        message: "Enter a valid customer mobile number, e.g. 0917 123 4567.",
      },
      { status: 400 },
    );
  }

  if (!message) {
    return NextResponse.json(
      { message: "Enter the message you want to send." },
      { status: 400 },
    );
  }

  await sendSmsMessage(normalizedMobile, message);

  const prisma = getPrisma();
  const createdRows = await prisma.$queryRaw<AdminTextMessageRow[]>`
    INSERT INTO "AdminTextMessage" (
      "id",
      "rentalId",
      "customerName",
      "mobile",
      "message"
    )
    VALUES (
      gen_random_uuid()::text,
      ${rentalId || null},
      ${customerName},
      ${normalizedMobile},
      ${message}
    )
    RETURNING
      "id",
      "rentalId",
      "customerName",
      "mobile",
      "message",
      "createdAt"
  `;
  const created = createdRows[0];

  if (!created) {
    throw new Error("Unable to save admin text message history.");
  }

  return NextResponse.json({
    messageLog: {
      createdAt: created.createdAt.getTime(),
      customerName: created.customerName,
      id: created.id,
      message: created.message,
      mobile: created.mobile,
      rentalId: created.rentalId,
    },
    sent: true,
  });
}
