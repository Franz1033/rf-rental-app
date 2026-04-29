import { RentalLineItem, RentalRecord, getOpenRentalItems, getRentalItems } from "@/app/rental-data";

const reminderLockPrefix = "rf-reminder-lock";
const adminPickupLockPrefix = "rf-admin-pickup-lock";
const reminderRetryCooldownMs = 5 * 60 * 1000;

type RentalNotificationEvent =
  | "activation"
  | "admin-pickup"
  | "reminder"
  | "return-all"
  | "return-item";

type NotificationItem = {
  durationMinutes: number;
  floatName: string;
};

function toNotificationItem(item: RentalLineItem): NotificationItem {
  return {
    durationMinutes: item.durationMinutes,
    floatName: item.floatName,
  };
}

export async function sendRentalNotification(
  event: RentalNotificationEvent,
  rental: RentalRecord,
  item?: RentalLineItem,
  items?: RentalLineItem[],
) {
  const payload = {
    cottageNumber: rental.cottageNumber,
    customerName: rental.customerName,
    event,
    item: item ? toNotificationItem(item) : undefined,
    items: (items ?? getRentalItems(rental)).map(toNotificationItem),
    mobile: rental.mobile,
    target: "customer" as const,
  };

  const response = await fetch("/api/rentals/notify", {
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      message?: string;
    };

    throw new Error(body.message ?? "Unable to send rental notification.");
  }
}

export function claimReminderLock(rentalId: string) {
  if (typeof window === "undefined") {
    return false;
  }

  const key = `${reminderLockPrefix}:${rentalId}`;
  const now = Date.now();
  const existingValue = window.localStorage.getItem(key);
  const lockedUntil = existingValue ? Number(existingValue) : 0;

  if (Number.isFinite(lockedUntil) && lockedUntil > now) {
    return false;
  }

  window.localStorage.setItem(
    key,
    String(now + reminderRetryCooldownMs),
  );
  return true;
}

export function releaseReminderLock(rentalId: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(`${reminderLockPrefix}:${rentalId}`);
}

export async function sendAdminPickupNotification(
  rental: RentalRecord,
  items?: RentalLineItem[],
) {
  const payload = {
    cottageNumber: rental.cottageNumber,
    customerName: rental.customerName,
    event: "admin-pickup" as const,
    items: (items ?? getOpenRentalItems(rental)).map(toNotificationItem),
    mobile: rental.mobile,
    target: "admin" as const,
  };

  const response = await fetch("/api/rentals/notify", {
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      message?: string;
    };

    throw new Error(body.message ?? "Unable to send admin pickup notification.");
  }
}

export function claimAdminPickupLock(rentalId: string) {
  if (typeof window === "undefined") {
    return false;
  }

  const key = `${adminPickupLockPrefix}:${rentalId}`;
  const now = Date.now();
  const existingValue = window.localStorage.getItem(key);
  const lockedUntil = existingValue ? Number(existingValue) : 0;

  if (Number.isFinite(lockedUntil) && lockedUntil > now) {
    return false;
  }

  window.localStorage.setItem(
    key,
    String(now + reminderRetryCooldownMs),
  );
  return true;
}

export function releaseAdminPickupLock(rentalId: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(`${adminPickupLockPrefix}:${rentalId}`);
}

export function getDueReminderItems(rental: RentalRecord, now: number) {
  return getOpenRentalItems(rental).filter(
    (item) =>
      rental.activatedAt &&
      rental.activatedAt + item.durationMinutes * 60 * 1000 - now <= 15 * 60 * 1000,
  );
}
