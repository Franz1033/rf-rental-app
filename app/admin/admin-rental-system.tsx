"use client";

import jsQR from "jsqr";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  RentalLineItem,
  RentalRecord,
  StatusBadge,
  formatAmountDue,
  formatCountdown,
  formatRentalDuration,
  formatTime,
  getOpenRentalItems,
  getRentalItems,
  isRentalFullyReturned,
  isRentalItemReturned,
  minutesLeft,
  useRentals,
} from "../rental-data";
import {
  claimReminderLock,
  getDueReminderItems,
  releaseReminderLock,
  sendRentalNotification,
} from "./rental-notifications";
import { pendingRentalExpirationMs } from "@/app/lib/rental-config";

type BarcodeResult = {
  rawValue: string;
};

type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => {
  detect: (source: CanvasImageSource) => Promise<BarcodeResult[]>;
};

export default function AdminRentalSystem() {
  const [rentals, updateRentals, refreshRentals] = useRentals();
  const [now, setNow] = useState(0);
  const [scanCode, setScanCode] = useState("");
  const [scannerMessage, setScannerMessage] = useState("");
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [openPendingMenuId, setOpenPendingMenuId] = useState<string | null>(
    null,
  );
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());

    tick();
    const interval = window.setInterval(tick, 1000);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const timestamp = now;

    if (!timestamp) {
      return;
    }

    rentals
      .filter(
        (rental) =>
          rental.status === "active" &&
          !rental.smsSentAt &&
          minutesLeft(rental, timestamp) <= 15,
      )
      .forEach((rental) => {
        if (!claimReminderLock(rental.id)) {
          return;
        }

        const dueItems = getDueReminderItems(rental, timestamp);

        if (dueItems.length === 0) {
          releaseReminderLock(rental.id);
          return;
        }

        void sendRentalNotification("reminder", rental, undefined, dueItems)
          .then(() => {
            updateRentals((current) =>
              current.map((entry) =>
                entry.id === rental.id && !entry.smsSentAt
                  ? { ...entry, smsSentAt: timestamp }
                  : entry,
              ),
            );
          })
          .catch(() => {});
      });
  }, [now, rentals, updateRentals]);

  useEffect(() => stopCameraScanner, []);

  useEffect(() => {
    const closeMenu = () => setOpenPendingMenuId(null);

    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, []);

  const pendingRentals = rentals.filter(
    (rental) => rental.status === "pending",
  );

  useEffect(() => {
    if (
      !now ||
      pendingRentals.length === 0 ||
      !pendingRentals.some(
        (rental) => getPendingExpiryTimestamp(rental) <= now,
      )
    ) {
      return;
    }

    void refreshRentals();
  }, [now, pendingRentals, refreshRentals]);

  const lookupCode = useMemo(() => extractRentalCode(scanCode), [scanCode]);

  const scannedRental = useMemo(
    () => rentals.find((rental) => rental.id === lookupCode),
    [rentals, lookupCode],
  );

  const activateRental = (rentalId: string) => {
    const rental = rentals.find((entry) => entry.id === rentalId);
    updateRentals((current) =>
      current.map((rental) =>
        rental.id === rentalId && rental.status === "pending"
          ? { ...rental, status: "active", activatedAt: Date.now() }
          : rental,
      ),
    );

    if (rental) {
      void sendRentalNotification("activation", rental).catch(() => {});
    }
  };

  const returnRental = (rentalId: string) => {
    const rental = rentals.find((entry) => entry.id === rentalId);
    updateRentals((current) =>
      current.map((rental) =>
        rental.id === rentalId && rental.status === "active"
          ? {
              ...rental,
              items: getRentalItems(rental).map((item) => ({
                ...item,
                returnedAt: item.returnedAt ?? Date.now(),
              })),
              status: "returned",
              returnedAt: Date.now(),
            }
          : rental,
      ),
    );

    if (rental) {
      void sendRentalNotification("return-all", rental).catch(() => {});
    }
  };

  const returnRentalItem = (
    rentalId: string,
    itemId: string | undefined,
    itemIndex: number,
  ) => {
    const timestamp = Date.now();
    const rental = rentals.find((entry) => entry.id === rentalId);
    const rentalItem = rental
      ? getOpenRentalItems(rental).find((item, index) =>
          itemId ? item.id === itemId : index === itemIndex,
        )
      : undefined;

    updateRentals((current) =>
      current.map((rental) => {
        if (rental.id !== rentalId || rental.status !== "active") {
          return rental;
        }

        let openItemPosition = -1;
        const nextItems = getRentalItems(rental).map((item) => {
          if (isRentalItemReturned(item)) {
            return item;
          }

          openItemPosition += 1;
          const matchesItem = itemId
            ? item.id === itemId
            : openItemPosition === itemIndex;

          return matchesItem ? { ...item, returnedAt: timestamp } : item;
        });

        const nextRental = { ...rental, items: nextItems };

        return isRentalFullyReturned(nextRental)
          ? {
              ...nextRental,
              status: "returned",
              returnedAt: timestamp,
            }
          : nextRental;
      }),
    );

    if (rental && rentalItem) {
      void sendRentalNotification("return-item", rental, rentalItem).catch(
        () => {},
      );
    }
  };

  const cancelRental = (rentalId: string) => {
    if (!window.confirm("Cancel this pending rental?")) {
      return;
    }

    updateRentals((current) =>
      current.map((rental) =>
        rental.id === rentalId && rental.status === "pending"
          ? { ...rental, status: "cancelled", cancelledAt: Date.now() }
          : rental,
      ),
    );
  };

  const getBarcodeDetector = () => {
    const Detector = (
      window as Window & {
        BarcodeDetector?: BarcodeDetectorConstructor;
      }
    ).BarcodeDetector as BarcodeDetectorConstructor | undefined;

    if (!Detector) {
      setScannerMessage("QR scanning is not supported in this browser.");
      return null;
    }

    return new Detector({ formats: ["qr_code"] });
  };

  const applyScannedValue = (value: string) => {
    const code = extractRentalCode(value);

    if (!code) {
      setScannerMessage("No RF rental code was found in that QR.");
      return false;
    }

    setScanCode(code);
    setScannerMessage(`Scanned ${code}. Verify the details before activating.`);
    return true;
  };

  function stopCameraScanner() {
    if (scanFrameRef.current) {
      cancelAnimationFrame(scanFrameRef.current);
      scanFrameRef.current = null;
    }

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setIsCameraOpen(false);
  }

  const startCameraScanner = async () => {
    const detector = getBarcodeDetector();

    if (!detector) {
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });

      streamRef.current = stream;
      setIsCameraOpen(true);
      setScannerMessage("Point the camera at the rental QR code.");

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      const scan = async () => {
        if (!videoRef.current || !streamRef.current) {
          return;
        }

        const results = await detector.detect(videoRef.current);

        if (results[0]?.rawValue && applyScannedValue(results[0].rawValue)) {
          stopCameraScanner();
          return;
        }

        scanFrameRef.current = requestAnimationFrame(scan);
      };

      scanFrameRef.current = requestAnimationFrame(scan);
    } catch {
      setScannerMessage("Camera access was blocked or unavailable.");
      stopCameraScanner();
    }
  };

  const scanUploadedQr = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      const rawValue = await decodeUploadedQr(file);

      if (!rawValue || !applyScannedValue(rawValue)) {
        setScannerMessage(
          "No readable QR rental code was found in that image.",
        );
      }
    } catch {
      setScannerMessage("Unable to scan that image. Try another QR photo.");
    } finally {
      event.target.value = "";
    }
  };

  return (
    <section className="space-y-5">
      <div className="mx-auto grid max-w-5xl items-start gap-6 lg:grid-cols-2">
        <section className="min-w-0 w-full max-w-full overflow-hidden rounded-lg border border-slate-900/80 bg-slate-950 p-4 text-white box-border">
            <h2 className="text-2xl font-bold">Retrieve rental</h2>
            <p className="mt-2 text-sm text-white/65">
              Scan, upload, or enter the rental code.
            </p>
            <div className="relative mt-4">
              <input
                className="h-12 w-full rounded-md border border-white/20 bg-white px-3 pr-12 text-base font-bold text-slate-950 outline-none"
                onChange={(event) =>
                  setScanCode(event.target.value.toUpperCase())
                }
                aria-label="Rental code"
                autoComplete="off"
                placeholder="Enter rental code..."
                spellCheck={false}
                value={scanCode}
              />
              {scanCode && (
                <button
                  aria-label="Clear rental code"
                  className="absolute right-2 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                  onClick={() => {
                    setScanCode("");
                    setScannerMessage("");
                  }}
                  type="button"
                >
                  <svg
                    aria-hidden="true"
                    className="size-4"
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                  >
                    <path d="M6 6l12 12" />
                    <path d="M18 6L6 18" />
                  </svg>
                </button>
              )}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                className={`flex h-11 items-center justify-center gap-2 rounded-md px-3 text-sm font-bold transition ${
                  isCameraOpen
                    ? "bg-white/85 text-slate-950"
                    : "bg-white text-slate-950 hover:bg-white/90"
                }`}
                onClick={isCameraOpen ? stopCameraScanner : startCameraScanner}
                type="button"
              >
                <svg
                  aria-hidden="true"
                  className="size-4"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path d="M4 7a3 3 0 0 1 3-3h2" />
                  <path d="M20 7a3 3 0 0 0-3-3h-2" />
                  <path d="M4 17a3 3 0 0 0 3 3h2" />
                  <path d="M20 17a3 3 0 0 1-3 3h-2" />
                  <path d="M9 12h6" />
                </svg>
                {isCameraOpen ? "Stop scan" : "Scan QR"}
              </button>
              <label className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-md border border-white/20 px-3 text-sm font-bold text-white transition hover:bg-white/5">
                <svg
                  aria-hidden="true"
                  className="size-4"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path d="M12 16V4" />
                  <path d="M8 8l4-4 4 4" />
                  <path d="M5 20h14" />
                </svg>
                Upload QR
                <input
                  accept="image/*"
                  className="sr-only"
                  onChange={scanUploadedQr}
                  type="file"
                />
              </label>
            </div>
            {isCameraOpen && (
              <video
                className="mt-3 aspect-video w-full rounded-md bg-black object-cover"
                muted
                playsInline
                ref={videoRef}
              />
            )}
            {scannerMessage && (
              <p className="mt-3 rounded-md bg-white/10 p-3 text-sm text-white/75">
                {scannerMessage}
              </p>
            )}
            {scannedRental ? (
              <RentalVerificationCard
                now={now}
                rental={scannedRental}
                onActivate={activateRental}
                onCancel={cancelRental}
                onReturn={returnRental}
                onReturnItem={returnRentalItem}
              />
            ) : lookupCode ? (
              <p className="mt-3 rounded-md bg-rose-500/15 p-3 text-sm text-rose-100">
                No rental found for {lookupCode}. Ask the customer to present
                the latest QR pass.
              </p>
            ) : null}
        </section>

        <section className="w-full max-w-full overflow-hidden rounded-lg border border-slate-200 bg-white p-4 box-border lg:self-start">
          <h2 className="text-lg font-bold">Pending rentals</h2>
          <div className="mt-3 space-y-3">
            {pendingRentals.length === 0 && (
              <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
                No pending rentals.
              </p>
            )}
            {pendingRentals.map((rental) => (
              <div
                className="rounded-md border border-slate-200 p-3 text-sm"
                key={rental.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <b className="block">{rental.id}</b>
                    <span className="mt-1 block text-slate-600">
                      {rental.customerName}
                    </span>
                    <span className="mt-2 inline-flex items-center rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-800">
                      Expires in{" "}
                      {formatPendingCountdown(rental, now)}
                    </span>
                  </div>
                  <div className="relative shrink-0">
                    <button
                      aria-expanded={openPendingMenuId === rental.id}
                      aria-haspopup="menu"
                      aria-label={`More actions for ${rental.id}`}
                      className="inline-flex size-9 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
                      onClick={(event) => {
                        event.stopPropagation();
                        setOpenPendingMenuId((current) =>
                          current === rental.id ? null : rental.id,
                        );
                      }}
                      type="button"
                    >
                      <svg
                        aria-hidden="true"
                        className="size-4"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <circle cx="5" cy="12" r="1.75" />
                        <circle cx="12" cy="12" r="1.75" />
                        <circle cx="19" cy="12" r="1.75" />
                      </svg>
                    </button>
                    {openPendingMenuId === rental.id && (
                      <div
                        className="absolute right-0 top-10 z-10 rounded-md border border-slate-200 bg-white p-1 shadow-lg"
                        onClick={(event) => event.stopPropagation()}
                        role="menu"
                      >
                        <button
                          className="flex items-center whitespace-nowrap rounded px-3 py-2 text-left text-sm font-semibold text-rose-700 transition hover:bg-rose-50"
                          onClick={() => {
                            setOpenPendingMenuId(null);
                            cancelRental(rental.id);
                          }}
                          role="menuitem"
                          type="button"
                        >
                          Cancel rental
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <button
                  className="mt-3 h-10 w-full rounded-md border border-slate-200 bg-slate-50 text-xs font-bold text-slate-700"
                  onClick={() => {
                    setScanCode(rental.id);
                    setScannerMessage("");
                  }}
                  type="button"
                >
                  View details
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}

function extractRentalCode(value: string) {
  return value.toUpperCase().match(/RF-[A-Z0-9]+/)?.[0] ?? "";
}

async function decodeUploadedQr(file: File) {
  const imageUrl = URL.createObjectURL(file);

  try {
    const image = await loadImage(imageUrl);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) {
      return "";
    }

    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    context.drawImage(image, 0, 0);

    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const result = jsQR(imageData.data, imageData.width, imageData.height);

    return result?.data ?? "";
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to load image."));
    image.src = src;
  });
}

function formatPaymentMode(rental: RentalRecord) {
  return rental.paymentMode === "Free" ? "Free rental" : rental.paymentMode;
}

function getPendingExpiryTimestamp(rental: RentalRecord) {
  return rental.createdAt + pendingRentalExpirationMs;
}

function getPendingSecondsLeft(rental: RentalRecord, now: number) {
  if (!now) {
    return Math.ceil(pendingRentalExpirationMs / 1000);
  }

  return Math.max(
    0,
    Math.ceil((getPendingExpiryTimestamp(rental) - now) / 1000),
  );
}

function formatPendingCountdown(rental: RentalRecord, now: number) {
  return formatCountdown(getPendingSecondsLeft(rental, now));
}

function RentalVerificationCard({
  rental,
  onActivate,
  onCancel,
  onReturn,
  onReturnItem,
  now,
}: {
  rental: RentalRecord;
  onActivate: (rentalId: string) => void;
  onCancel: (rentalId: string) => void;
  onReturn: (rentalId: string) => void;
  onReturnItem: (
    rentalId: string,
    itemId: string | undefined,
    itemIndex: number,
  ) => void;
  now: number;
}) {
  return (
    <div className="mt-4 rounded-lg border border-white/10 bg-white/10 p-3 text-sm">
      <div className="rounded-lg bg-slate-950/25 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-mono text-xl font-bold text-white">
              {rental.id}
            </p>
          </div>
          <StatusBadge status={rental.status} />
        </div>
      </div>
      <dl className="mt-3 divide-y divide-white/10 rounded-lg bg-slate-950/15">
        <CompactDetailRow label="Customer" value={rental.customerName} />
        <CompactDetailRow label="Mobile" value={rental.mobile} />
        <CompactDetailRow label="Payment" value={formatPaymentMode(rental)} />
        <CompactDetailRow
          label="Amount due"
          value={formatAmountDue(rental.amountDue)}
        />
        <CompactDetailRow
          label="Created"
          value={formatTime(rental.createdAt)}
        />
        {rental.status === "pending" && (
          <CompactDetailRow
            label="Expires in"
            value={formatPendingCountdown(rental, now)}
          />
        )}
      </dl>
      {rental.status !== "active" && (
        <div className="mt-3 rounded-lg bg-slate-950/15 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/45">
            Rented items
          </p>
          <div className="mt-2 space-y-2">
            {getRentalItems(rental).map((item, index) => (
              <div
                className="rounded-md bg-white/5 px-3 py-2.5"
                key={item.id ?? `${item.floatId}-${index}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <b className="text-white">{item.floatName}</b>
                  <span className="shrink-0 text-sm font-semibold text-white/75">
                    {formatRentalDuration(item.durationMinutes)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {rental.status === "pending" && (
        <div className="mt-3 grid gap-2">
          <button
            className="h-11 w-full rounded-md bg-amber-300 px-4 font-bold text-slate-950"
            onClick={() => onActivate(rental.id)}
            type="button"
          >
            Activate
          </button>
          <button
            className="h-11 w-full rounded-md bg-rose-600 px-4 font-bold text-white hover:bg-rose-500"
            onClick={() => onCancel(rental.id)}
            type="button"
          >
            Cancel rental
          </button>
        </div>
      )}
      {rental.status === "active" && (
        <div className="mt-3 space-y-2">
          {getRentalItems(rental).map((item, index) => (
            <ActiveReturnItemCard
              item={item}
              itemIndex={index}
              key={item.id ?? `${item.floatId}-${index}`}
              onReturnItem={onReturnItem}
              rental={rental}
            />
          ))}
          {getOpenRentalItems(rental).length > 1 && (
            <button
              className="h-11 w-full rounded-md bg-emerald-300 px-4 font-bold text-slate-950"
              onClick={() => onReturn(rental.id)}
              type="button"
            >
              Return all remaining items
            </button>
          )}
        </div>
      )}
      {rental.status === "returned" && (
        <p className="mt-3 rounded-md bg-white/10 p-3 text-white/75">
          This rental has already been closed.
        </p>
      )}
      {rental.status === "cancelled" && (
        <p className="mt-3 rounded-md bg-white/10 p-3 text-white/75">
          This pending rental was cancelled and cannot be activated.
        </p>
      )}
      {rental.status === "expired" && (
        <p className="mt-3 rounded-md bg-white/10 p-3 text-white/75">
          This pending rental expired and can no longer be activated.
        </p>
      )}
    </div>
  );
}

function ActiveReturnItemCard({
  item,
  itemIndex,
  onReturnItem,
  rental,
}: {
  item: RentalLineItem;
  itemIndex: number;
  onReturnItem: (
    rentalId: string,
    itemId: string | undefined,
    itemIndex: number,
  ) => void;
  rental: RentalRecord;
}) {
  return (
    <div className="rounded-md bg-white/10 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <b className="text-white">{item.floatName}</b>
          <p className="mt-1 text-white/75">
            {formatRentalDuration(item.durationMinutes)} ·{" "}
            {formatAmountDue(item.subtotal)}
          </p>
          {isRentalItemReturned(item) && (
            <p className="mt-1 text-xs font-semibold text-emerald-300">
              Returned {formatTime(item.returnedAt)}
            </p>
          )}
        </div>
        {!isRentalItemReturned(item) && (
          <button
            className="rounded-md border border-emerald-200 bg-emerald-300 px-3 py-2 text-xs font-bold text-slate-950"
            onClick={() => onReturnItem(rental.id, item.id, itemIndex)}
            type="button"
          >
            Return item
          </button>
        )}
      </div>
    </div>
  );
}

function CompactDetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[104px_minmax(0,1fr)] items-center gap-3 px-3 py-2.5">
      <dt className="leading-none text-[10px] font-semibold uppercase tracking-[0.14em] text-white/45">
        {label}
      </dt>
      <dd className="min-w-0 text-right font-semibold leading-none text-white">
        {value}
      </dd>
    </div>
  );
}
