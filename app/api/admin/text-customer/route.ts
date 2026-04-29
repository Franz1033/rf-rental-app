import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isAuthenticatedAdmin } from "@/app/lib/admin-auth";
import { sendSmsMessage } from "@/app/lib/sms";

type TextCustomerRequestBody = {
  message?: string;
  mobile?: string;
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

export async function POST(request: Request) {
  const unauthorizedResponse = await requireAdmin();

  if (unauthorizedResponse) {
    return unauthorizedResponse;
  }

  const body = (await request.json().catch(() => null)) as
    | TextCustomerRequestBody
    | null;
  const message = body?.message?.trim() ?? "";
  const normalizedMobile = normalizePhilippineMobile(body?.mobile?.trim() ?? "");

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

  return NextResponse.json({ sent: true });
}
