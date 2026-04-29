"use client";

import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";

export type FloatItem = {
  id: string;
  name: string;
  price: number;
  damageFee: number;
  maxHours: number;
  maxQuantity: number;
  availableQuantity: number;
  imageUrl: string;
};

export type PaymentMode = "Cash" | "GCash" | "Free";
export type RentalStatus =
  | "pending"
  | "active"
  | "returned"
  | "cancelled"
  | "expired";

export type RentalLineItem = {
  id?: string;
  floatId: string;
  floatName: string;
  price: number;
  quantity: number;
  durationMinutes: number;
  subtotal: number;
  returnedAt?: number;
};

export type RentalRecord = {
  id: string;
  floatId: string;
  floatName: string;
  price: number;
  items?: RentalLineItem[];
  customerName: string;
  cottageNumber: string;
  mobile: string;
  verificationCode: string;
  paymentMode: PaymentMode;
  amountDue: number;
  status: RentalStatus;
  createdAt: number;
  activatedAt?: number;
  returnedAt?: number;
  cancelledAt?: number;
  smsSentAt?: number;
  adminPickupAlertSentAt?: number;
  durationMinutes: number;
};

const rentalStorageKey = "rf-rental-records";
const emptyRentals: RentalRecord[] = [];
const rentalItemsStorageKey = "rf-rental-items";
const emptyFloatItems: FloatItem[] = [];
let rentalsCache: RentalRecord[] = emptyRentals;
const rentalListeners = new Set<(rentals: RentalRecord[]) => void>();
const serverClockListeners = new Set<(offsetMs: number) => void>();
let rentalSaveInFlight = false;
let latestRentalSaveRequestId = 0;
let serverTimeOffsetMs = 0;

export const rules = [
  "Rental time starts from cashier activation and follows the selected duration.",
  "Return the exact float assigned to you.",
  "Lost or damaged floats are charged using the listed replacement fee.",
  "Keep sharp objects, food dye, and rough play away from all inflatables.",
  "A return reminder is sent by SMS 15 minutes before time expires.",
];

export const formatPeso = (amount: number) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 0,
  }).format(amount);

export const formatRentalPrice = (amount: number) =>
  amount === 0 ? "Free" : `${formatPeso(amount)} per hour`;

export const formatAmountDue = (amount: number) =>
  amount === 0 ? "Free" : formatPeso(amount);

export const formatRentalDuration = (durationMinutes: number) => {
  const hours = durationMinutes / 60;

  return hours === 1 ? "1 hour" : `${hours} hours`;
};

export const formatRentalDurationSummary = (rental: RentalRecord) => {
  const durations = Array.from(
    new Set(getRentalItems(rental).map((item) => item.durationMinutes)),
  ).sort((a, b) => a - b);

  return durations.length === 1
    ? formatRentalDuration(durations[0])
    : durations.map(formatRentalDuration).join(" / ");
};

export const getRentalItems = (rental: RentalRecord): RentalLineItem[] =>
  rental.items?.length
    ? rental.items
    : [
        {
          id: `${rental.id}-item-0`,
          floatId: rental.floatId,
          floatName: rental.floatName,
          price: rental.price,
          quantity: 1,
          durationMinutes: rental.durationMinutes,
          subtotal: rental.amountDue,
        },
      ];

export const isRentalItemReturned = (item: RentalLineItem) =>
  typeof item.returnedAt === "number";

export const getOpenRentalItems = (rental: RentalRecord) =>
  getRentalItems(rental).filter((item) => !isRentalItemReturned(item));

export const isRentalFullyReturned = (rental: RentalRecord) =>
  getOpenRentalItems(rental).length === 0;

export const getRentalTitle = (rental: RentalRecord) => {
  const items = getRentalItems(rental);

  return items.length === 1
    ? items[0].floatName
    : `${items.length} items rented`;
};

export const formatTime = (timestamp?: number) =>
  timestamp
    ? new Intl.DateTimeFormat("en-PH", {
        hour: "numeric",
        minute: "2-digit",
        month: "short",
        day: "numeric",
      }).format(timestamp)
    : "Not yet";

export const minutesLeft = (rental: RentalRecord, now: number) => {
  return Math.ceil(secondsLeft(rental, now) / 60);
};

export const itemSecondsLeft = (
  rental: RentalRecord,
  item: RentalLineItem,
  now: number,
) => {
  if (isRentalItemReturned(item)) {
    return 0;
  }

  if (!rental.activatedAt || rental.status !== "active") {
    return item.durationMinutes * 60;
  }

  const elapsed = Math.floor((now - rental.activatedAt) / 1000);
  return Math.max(item.durationMinutes * 60 - elapsed, 0);
};

export const secondsLeft = (rental: RentalRecord, now: number) => {
  const items = getOpenRentalItems(rental);

  if (items.length === 0) {
    return 0;
  }

  if (!rental.activatedAt || rental.status !== "active") {
    return Math.min(...items.map((item) => item.durationMinutes * 60));
  }

  return Math.min(...items.map((item) => itemSecondsLeft(rental, item, now)));
};

export const formatCountdown = (totalSeconds: number) => {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const paddedMinutes = String(minutes).padStart(2, "0");
  const paddedSeconds = String(seconds).padStart(2, "0");

  return hours > 0
    ? `${hours}:${paddedMinutes}:${paddedSeconds}`
    : `${minutes}:${paddedSeconds}`;
};

export const normalizePhilippineMobile = (mobile: string) => {
  const digits = mobile.replace(/\D/g, "");

  if (digits.startsWith("09") && digits.length === 11) {
    return `+63${digits.slice(1)}`;
  }

  if (digits.startsWith("639") && digits.length === 12) {
    return `+${digits}`;
  }

  return "";
};

export const isValidPhilippineMobile = (mobile: string) =>
  normalizePhilippineMobile(mobile) !== "";

export const makeQrCells = (value: string) => {
  let seed = 0;

  for (let index = 0; index < value.length; index += 1) {
    seed = (seed * 31 + value.charCodeAt(index)) % 9973;
  }

  return Array.from({ length: 49 }, (_, index) => {
    const row = Math.floor(index / 7);
    const col = index % 7;
    const finder =
      (row < 2 && col < 2) || (row < 2 && col > 4) || (row > 4 && col < 2);

    return finder || (seed + row * 17 + col * 29 + index) % 3 === 0;
  });
};

const readStoredRentals = () => {
  if (typeof window === "undefined") {
    return emptyRentals;
  }

  const stored = window.localStorage.getItem(rentalStorageKey);
  return stored ? (JSON.parse(stored) as RentalRecord[]) : emptyRentals;
};

const normalizeFloatItems = (items: FloatItem[]) =>
  items.map((item) => ({
    ...item,
    availableQuantity:
      typeof item.availableQuantity === "number"
        ? item.availableQuantity
        : item.maxQuantity,
  }));

const publishRentals = (nextRentals: RentalRecord[]) => {
  rentalsCache = nextRentals;

  if (typeof window !== "undefined") {
    window.localStorage.setItem(
      rentalStorageKey,
      JSON.stringify(nextRentals),
    );
    window.dispatchEvent(new CustomEvent("rf-rentals-changed"));
  }

  rentalListeners.forEach((listener) => listener(nextRentals));
};

const publishServerTimeOffset = (nextOffsetMs: number) => {
  if (serverTimeOffsetMs === nextOffsetMs) {
    return;
  }

  serverTimeOffsetMs = nextOffsetMs;
  serverClockListeners.forEach((listener) => listener(nextOffsetMs));
};

const syncServerClock = (response: Response) => {
  const rawServerTime =
    response.headers.get("x-server-time") ?? response.headers.get("date");

  if (!rawServerTime) {
    return;
  }

  const parsedServerTime = /^\d+$/.test(rawServerTime)
    ? Number(rawServerTime)
    : Date.parse(rawServerTime);

  if (!Number.isFinite(parsedServerTime)) {
    return;
  }

  publishServerTimeOffset(parsedServerTime - Date.now());
};

export const getServerNow = () => Date.now() + serverTimeOffsetMs;

export function useServerNow() {
  const [now, setNow] = useState(() => getServerNow());

  useEffect(() => {
    const syncNow = () => setNow(getServerNow());

    serverClockListeners.add(syncNow);
    syncNow();

    const interval = window.setInterval(syncNow, 1000);

    return () => {
      serverClockListeners.delete(syncNow);
      window.clearInterval(interval);
    };
  }, []);

  return now;
}

export function useRentals() {
  const [rentals, setRentals] = useState<RentalRecord[]>(rentalsCache);

  useEffect(() => {
    rentalListeners.add(setRentals);

    if (rentalsCache.length === 0) {
      const stored = readStoredRentals();
      if (stored.length > 0) {
        publishRentals(stored);
      }
    }

    return () => {
      rentalListeners.delete(setRentals);
    };
  }, []);

  const refreshRentals = useCallback(async () => {
    try {
      const response = await fetch("/api/rentals", {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Unable to load rentals.");
      }

      syncServerClock(response);
      const nextRentals = (await response.json()) as RentalRecord[];

      if (rentalSaveInFlight) {
        return;
      }

      publishRentals(nextRentals);
    } catch {
      publishRentals(readStoredRentals());
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void refreshRentals();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [refreshRentals]);

  const updateRentals = useCallback(
    (updater: (current: RentalRecord[]) => RentalRecord[]) => {
      setRentals((current) => {
        const nextRentals = updater(current);

        if (nextRentals === current) {
          return current;
        }

        publishRentals(nextRentals);
        rentalSaveInFlight = true;
        const saveRequestId = ++latestRentalSaveRequestId;
        fetch("/api/rentals", {
          body: JSON.stringify(nextRentals),
          headers: {
            "Content-Type": "application/json",
          },
          method: "PUT",
        })
          .then((response) => {
            if (!response.ok) {
              throw new Error("Unable to save rentals.");
            }
            syncServerClock(response);
            return response.json() as Promise<RentalRecord[]>;
          })
          .then((savedRentals) => {
            if (saveRequestId !== latestRentalSaveRequestId) {
              return;
            }

            rentalSaveInFlight = false;
            publishRentals(savedRentals);
          })
          .catch(() => {
            if (saveRequestId !== latestRentalSaveRequestId) {
              return;
            }

            rentalSaveInFlight = false;
            publishRentals(current);
          });

        return nextRentals;
      });
    },
    [],
  );

  return [rentals, updateRentals, refreshRentals] as const;
}

export function useRentalItems() {
  const [items, setItems] = useState<FloatItem[]>(emptyFloatItems);
  const [isLoading, setIsLoading] = useState(true);
  const latestRequestIdRef = useRef(0);

  const refreshItems = useCallback(async () => {
    const requestId = latestRequestIdRef.current + 1;
    latestRequestIdRef.current = requestId;
    setIsLoading(true);

    try {
      const response = await fetch("/api/rental-items", {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Unable to load rental items.");
      }

      const nextItems = (await response.json()) as FloatItem[];
      const normalizedItems = normalizeFloatItems(nextItems);

      if (requestId !== latestRequestIdRef.current) {
        return;
      }

      setItems(normalizedItems);
      window.localStorage.setItem(
        rentalItemsStorageKey,
        JSON.stringify(normalizedItems),
      );
    } catch {
      if (requestId !== latestRequestIdRef.current) {
        return;
      }

      const stored = window.localStorage.getItem(rentalItemsStorageKey);
      setItems(
        stored
          ? normalizeFloatItems(JSON.parse(stored) as FloatItem[])
          : emptyFloatItems,
      );
    } finally {
      if (requestId === latestRequestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void refreshItems();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [refreshItems]);

  useEffect(() => {
    const handleRentalsChanged = () => {
      void refreshItems();
    };

    window.addEventListener("rf-rentals-changed", handleRentalsChanged);

    return () => {
      window.removeEventListener("rf-rentals-changed", handleRentalsChanged);
    };
  }, [refreshItems]);

  return [items, refreshItems, isLoading] as const;
}

export function QrPass({ rental }: { rental: RentalRecord }) {
  const [qrDataUrl, setQrDataUrl] = useState("");

  useEffect(() => {
    let isMounted = true;

    QRCode.toDataURL(rental.id, {
      errorCorrectionLevel: "M",
      margin: 2,
      scale: 8,
    }).then((dataUrl) => {
      if (isMounted) {
        setQrDataUrl(dataUrl);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [rental.id]);

  if (qrDataUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        alt={`QR code for rental ${rental.id}`}
        className="mx-auto size-44 rounded-md border border-slate-200 bg-white p-2 shadow-sm"
        src={qrDataUrl}
      />
    );
  }

  const cells = makeQrCells(rental.id);

  return (
    <div className="mx-auto grid size-44 grid-cols-7 gap-1 rounded-md border border-slate-200 bg-white p-3 shadow-sm">
      {cells.map((active, index) => (
        <span
          className={`rounded-[2px] ${active ? "bg-slate-950" : "bg-white"}`}
          key={`${rental.id}-${index}`}
        />
      ))}
    </div>
  );
}

export function StatusBadge({ status }: { status: RentalStatus }) {
  const styles = {
    pending: "bg-amber-100 text-amber-800",
    active: "bg-emerald-100 text-emerald-800",
    returned: "bg-slate-200 text-slate-700",
    cancelled: "bg-rose-100 text-rose-800",
    expired: "bg-orange-100 text-orange-800",
  };

  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${styles[status]}`}
    >
      {status}
    </span>
  );
}
