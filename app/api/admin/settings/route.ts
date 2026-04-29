import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getPrisma } from "@/app/lib/prisma";
import { isAuthenticatedAdmin } from "@/app/lib/admin-auth";

const adminConfigId = "default";
type AdminConfigRow = {
  notificationMobile: string;
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

export async function GET() {
  const unauthorizedResponse = await requireAdmin();

  if (unauthorizedResponse) {
    return unauthorizedResponse;
  }

  const config = await readOrCreateAdminConfig();

  return NextResponse.json({
    notificationMobile: config.notificationMobile,
  });
}

export async function PATCH(request: Request) {
  const unauthorizedResponse = await requireAdmin();

  if (unauthorizedResponse) {
    return unauthorizedResponse;
  }

  const body = (await request.json().catch(() => null)) as
    | { notificationMobile?: string }
    | null;
  const rawMobile = body?.notificationMobile?.trim() ?? "";

  if (rawMobile && !isValidPhilippineMobile(rawMobile)) {
    return NextResponse.json(
      {
        message:
          "Enter a valid PH mobile number for admin notifications, e.g. 0917 123 4567.",
      },
      { status: 400 },
    );
  }

  const config = await writeAndReadAdminConfig(
    rawMobile ? normalizePhilippineMobile(rawMobile) : "",
  );

  return NextResponse.json({
    notificationMobile: config.notificationMobile,
  });
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

function isValidPhilippineMobile(mobile: string) {
  return normalizePhilippineMobile(mobile) !== "";
}

async function readOrCreateAdminConfig() {
  const prisma = getPrisma();

  await prisma.$executeRaw`
    INSERT INTO "AdminConfig" ("id", "notificationMobile", "updatedAt")
    VALUES (${adminConfigId}, ${""}, CURRENT_TIMESTAMP)
    ON CONFLICT ("id") DO NOTHING
  `;

  const rows = await prisma.$queryRaw<AdminConfigRow[]>`
    SELECT "notificationMobile"
    FROM "AdminConfig"
    WHERE "id" = ${adminConfigId}
    LIMIT 1
  `;

  return rows[0] ?? { notificationMobile: "" };
}

async function writeAndReadAdminConfig(notificationMobile: string) {
  const prisma = getPrisma();

  await prisma.$executeRaw`
    INSERT INTO "AdminConfig" ("id", "notificationMobile", "updatedAt")
    VALUES (${adminConfigId}, ${notificationMobile}, CURRENT_TIMESTAMP)
    ON CONFLICT ("id") DO UPDATE SET
      "notificationMobile" = EXCLUDED."notificationMobile",
      "updatedAt" = CURRENT_TIMESTAMP
  `;

  const rows = await prisma.$queryRaw<AdminConfigRow[]>`
    SELECT "notificationMobile"
    FROM "AdminConfig"
    WHERE "id" = ${adminConfigId}
    LIMIT 1
  `;

  return rows[0] ?? { notificationMobile: "" };
}
