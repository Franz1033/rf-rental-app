import { NextResponse } from "next/server";
import { maskMobileForLogs, sendSmsMessage } from "@/app/lib/sms";
import { getPrisma } from "@/app/lib/prisma";
type AdminConfigRow = {
  notificationMobile: string;
};

type NotifyItem = {
  durationMinutes: number;
  floatName: string;
};

type NotifyRequestBody = {
  cottageNumber?: string;
  customerName?: string;
  event?: "activation" | "admin-pickup" | "reminder" | "return-all" | "return-item";
  item?: NotifyItem;
  items?: NotifyItem[];
  mobile?: string;
  target?: "admin" | "customer";
};

function formatDuration(durationMinutes: number) {
  const hours = durationMinutes / 60;
  return hours === 1 ? "1 hour" : `${hours} hours`;
}

function formatItemSummary(items: NotifyItem[]) {
  return items
    .map((item) => `${item.floatName} - ${formatDuration(item.durationMinutes)}`)
    .join("; ");
}

function buildNotificationMessage(body: NotifyRequestBody) {
  switch (body.event) {
    case "activation":
      return `Royal Farm: Your rental is now active. ${formatItemSummary(body.items ?? [])}. Please return each item on time.`;
    case "admin-pickup":
      return `Royal Farm Admin: Pickup due for ${body.customerName ?? "customer"}${body.cottageNumber ? ` at cottage ${body.cottageNumber}` : ""}. ${formatItemSummary(body.items ?? [])} time is over. Please collect the item.`;
    case "reminder":
      return `Royal Farm: Reminder: ${formatItemSummary(body.items ?? [])} will end in 15 minutes. Please prepare to return it on time.`;
    case "return-all":
      return "Royal Farm: Your rental has been marked returned. Thank you.";
    case "return-item":
      return body.item
        ? `Royal Farm: ${body.item.floatName} has been marked returned. Thank you.`
        : "Royal Farm: Your rental item has been marked returned. Thank you.";
    default:
      return "";
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | NotifyRequestBody
    | null;
  const fallbackMobile = body?.mobile?.trim();
  const message = body ? buildNotificationMessage(body) : "";
  let mobile = fallbackMobile;

  if (body?.target === "admin") {
    const adminConfigRows = await getPrisma().$queryRaw<AdminConfigRow[]>`
      SELECT "notificationMobile"
      FROM "AdminConfig"
      WHERE "id" = ${"default"}
      LIMIT 1
    `;
    mobile = adminConfigRows[0]?.notificationMobile?.trim() || "";
  }

  if (!mobile || !message) {
    console.warn("[sms] Rental notification request missing payload", {
      event: body?.event ?? null,
      hasMessage: Boolean(message),
      mobile: mobile ? maskMobileForLogs(mobile) : "",
    });
    return NextResponse.json(
      { message: "Missing rental notification payload." },
      { status: 400 },
    );
  }

  try {
    console.info("[sms] Rental notification request received", {
      event: body?.event ?? null,
      messageLength: message.length,
      mobile: maskMobileForLogs(mobile),
    });
    await sendSmsMessage(mobile, message);
    return NextResponse.json({ sent: true });
  } catch (error) {
    console.error("[sms] Rental notification request failed", {
      error: error instanceof Error ? error.message : "Unknown error",
      event: body?.event ?? null,
      mobile: maskMobileForLogs(mobile),
    });
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Unable to send rental notification.",
      },
      { status: 500 },
    );
  }
}
