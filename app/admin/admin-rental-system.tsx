"use client";

import jsQR from "jsqr";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  getServerNow,
  RentalLineItem,
  RentalRecord,
  formatAmountDue,
  formatCountdown,
  formatRentalDuration,
  formatTime,
  getOpenRentalItems,
  getRentalItems,
  isRentalFullyReturned,
  isRentalItemReturned,
  minutesLeft,
  secondsLeft,
  useRentals,
  useServerNow,
} from "../rental-data";
import {
  claimAdminPickupLock,
  claimReminderLock,
  getDueReminderItems,
  releaseAdminPickupLock,
  releaseReminderLock,
  sendAdminPickupNotification,
  sendRentalNotification,
} from "./rental-notifications";
import { pendingRentalExpirationMs } from "@/app/lib/rental-config";

type BarcodeResult = {
  rawValue: string;
};

type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => {
  detect: (source: CanvasImageSource) => Promise<BarcodeResult[]>;
};

type BarcodeDetectorInstance = {
  detect: (source: CanvasImageSource) => Promise<BarcodeResult[]>;
};

export default function AdminRentalSystem() {
  const [rentals, updateRentals, refreshRentals] = useRentals();
  const now = useServerNow();
  const [scanCode, setScanCode] = useState("");
  const [scannerMessage, setScannerMessage] = useState("");
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isResolvingLookup, setIsResolvingLookup] = useState(false);
  const [openPendingMenuId, setOpenPendingMenuId] = useState<string | null>(
    null,
  );
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanFrameRef = useRef<number | null>(null);
  const attemptedLookupRef = useRef("");

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

  useEffect(() => {
    const timestamp = now;

    if (!timestamp) {
      return;
    }

    rentals
      .filter(
        (rental) =>
          rental.status === "active" &&
          !rental.adminPickupAlertSentAt &&
          getOpenRentalItems(rental).length > 0 &&
          secondsLeft(rental, timestamp) === 0,
      )
      .forEach((rental) => {
        if (!claimAdminPickupLock(rental.id)) {
          return;
        }

        const dueItems = getOpenRentalItems(rental);

        if (dueItems.length === 0) {
          releaseAdminPickupLock(rental.id);
          return;
        }

        void sendAdminPickupNotification(rental, dueItems)
          .then(() => {
            updateRentals((current) =>
              current.map((entry) =>
                entry.id === rental.id && !entry.adminPickupAlertSentAt
                  ? { ...entry, adminPickupAlertSentAt: timestamp }
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
      !pendingRentals.some((rental) => getPendingExpiryTimestamp(rental) <= now)
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

  useEffect(() => {
    if (!lookupCode) {
      attemptedLookupRef.current = "";
      return;
    }

    if (scannedRental || attemptedLookupRef.current === lookupCode) {
      return;
    }

    attemptedLookupRef.current = lookupCode;
    setIsResolvingLookup(true);

    void refreshRentals().finally(() => {
      setIsResolvingLookup(false);
    });
  }, [lookupCode, refreshRentals, scannedRental]);

  const activateRental = (rentalId: string) => {
    const rental = rentals.find((entry) => entry.id === rentalId);
    updateRentals((current) =>
      current.map((rental) =>
        rental.id === rentalId && rental.status === "pending"
          ? { ...rental, status: "active", activatedAt: getServerNow() }
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
                returnedAt: item.returnedAt ?? getServerNow(),
              })),
              status: "returned",
              returnedAt: getServerNow(),
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
    const timestamp = getServerNow();
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
          ? { ...rental, status: "cancelled", cancelledAt: getServerNow() }
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
    setIsResolvingLookup(false);
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

  const waitForVideoReady = (video: HTMLVideoElement) =>
    new Promise<void>((resolve, reject) => {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        resolve();
        return;
      }

      const handleReady = () => {
        cleanup();
        resolve();
      };
      const handleError = () => {
        cleanup();
        reject(new Error("Camera preview could not start."));
      };
      const cleanup = () => {
        video.removeEventListener("loadedmetadata", handleReady);
        video.removeEventListener("loadeddata", handleReady);
        video.removeEventListener("canplay", handleReady);
        video.removeEventListener("error", handleError);
      };

      video.addEventListener("loadedmetadata", handleReady, { once: true });
      video.addEventListener("loadeddata", handleReady, { once: true });
      video.addEventListener("canplay", handleReady, { once: true });
      video.addEventListener("error", handleError, { once: true });
    });

  const scanVideoFrameWithJsQr = (video: HTMLVideoElement) => {
    const width = video.videoWidth;
    const height = video.videoHeight;

    if (!width || !height) {
      return "";
    }

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", {
      willReadFrequently: true,
    });

    if (!context) {
      return "";
    }

    canvas.width = width;
    canvas.height = height;
    context.drawImage(video, 0, 0, width, height);

    const imageData = context.getImageData(0, 0, width, height);
    const result = jsQR(imageData.data, imageData.width, imageData.height);

    return result?.data ?? "";
  };

  const scanVideoFrame = async (
    video: HTMLVideoElement,
    detector: BarcodeDetectorInstance | null,
  ) => {
    if (detector) {
      try {
        const results = await detector.detect(video);
        return results[0]?.rawValue ?? "";
      } catch {
        return scanVideoFrameWithJsQr(video);
      }
    }

    return scanVideoFrameWithJsQr(video);
  };

  const waitForVideoElement = () =>
    new Promise<HTMLVideoElement | null>((resolve) => {
      const startedAt = Date.now();

      const check = () => {
        if (videoRef.current) {
          resolve(videoRef.current);
          return;
        }

        if (Date.now() - startedAt > 1500) {
          resolve(null);
          return;
        }

        requestAnimationFrame(check);
      };

      check();
    });

  const startCameraScanner = async () => {
    const detector = getBarcodeDetector();

    try {
      stopCameraScanner();

      if (!navigator.mediaDevices?.getUserMedia) {
        setScannerMessage("Camera is not supported on this browser.");
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: "environment",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      streamRef.current = stream;
      setIsCameraOpen(true);

      setScannerMessage(
        detector
          ? "Point the camera at the rental QR code."
          : "Point the camera at the rental QR code. Using Safari fallback scanner.",
      );

      const video = await waitForVideoElement();

      if (!video) {
        setScannerMessage("Camera preview element is missing.");
        stopCameraScanner();
        return;
      }

      video.srcObject = stream;
      video.muted = true;
      video.autoplay = true;
      video.playsInline = true;

      video.setAttribute("muted", "true");
      video.setAttribute("autoplay", "true");
      video.setAttribute("playsinline", "true");
      video.setAttribute("webkit-playsinline", "true");

      await waitForVideoReady(video);
      await video.play();

      const scan = async () => {
        if (!videoRef.current || !streamRef.current) return;

        const rawValue = await scanVideoFrame(videoRef.current, detector);

        if (rawValue && applyScannedValue(rawValue)) {
          stopCameraScanner();
          return;
        }

        scanFrameRef.current = requestAnimationFrame(scan);
      };

      scanFrameRef.current = requestAnimationFrame(scan);
    } catch (error) {
      console.error(error);
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
      <div className="mx-auto max-w-6xl">
        <h1 className="mb-4 text-2xl font-semibold tracking-tight text-[var(--rf-ink)]">
          Home
        </h1>
        <div className="grid items-start gap-4 xl:grid-cols-2">
          <section className="min-w-0 w-full max-w-full rounded-md border border-slate-200 bg-white shadow-sm box-border">
            <div className="rounded-t-md border-b border-slate-200 bg-[linear-gradient(180deg,#f7fbf8_0%,#eef6f0_100%)] px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xl font-medium text-[var(--rf-ink)]">
                  Retrieve Rental
                </h2>
                <span className="inline-flex size-9 items-center justify-center rounded-md border border-[#1f7a36] bg-[#1f7a36] text-white">
                  <svg
                    aria-hidden="true"
                    className="size-4 shrink-0"
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                  >
                    <path d="M21 21l-4.35-4.35" />
                    <circle cx="11" cy="11" r="6" />
                  </svg>
                </span>
              </div>
            </div>

            <div className="p-5">
              <div className="space-y-3">
                <div className="relative min-w-0">
                  <input
                    className="h-12 w-full rounded-md border border-slate-300 bg-white px-4 pr-12 text-base font-semibold text-slate-950 outline-none transition focus:border-[var(--rf-blue)]"
                    onChange={(event) => {
                      setScanCode(event.target.value.toUpperCase());
                      setIsResolvingLookup(false);
                    }}
                    aria-label="Rental code"
                    autoComplete="off"
                    placeholder="Enter rental code"
                    spellCheck={false}
                    value={scanCode}
                  />
                  {scanCode && (
                    <button
                      aria-label="Clear rental code"
                      className="absolute right-2 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                      onClick={() => {
                        setScanCode("");
                        setIsResolvingLookup(false);
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

                <div className="grid grid-cols-2 gap-2">
                  <button
                    className={`flex h-12 items-center justify-center gap-2 rounded-md border px-3 text-sm font-semibold transition ${
                      isCameraOpen
                        ? "border-[#17642b] bg-[linear-gradient(180deg,#3fa55b_0%,#2f8f49_62%,#1f7a36_100%)] text-white shadow-sm"
                        : "border-[#1f7a36] bg-[#1f7a36] text-white hover:bg-[#17642b] hover:border-[#17642b]"
                    }`}
                    onClick={
                      isCameraOpen ? stopCameraScanner : startCameraScanner
                    }
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
                  {isCameraOpen ? "Stop" : "Scan QR"}
                  </button>
                  <label className="flex h-12 cursor-pointer items-center justify-center gap-2 rounded-md border border-[#b9d8c3] bg-[#f4faf5] px-3 text-sm font-semibold text-[#1f7a36] transition hover:border-[#93c5a0] hover:bg-[#eef6f0]">
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
              </div>

              {isCameraOpen && (
                <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
                  <video
                    autoPlay
                    muted
                    playsInline
                    ref={videoRef}
                    className="aspect-video w-full rounded-md bg-black object-cover"
                  />
                </div>
              )}

              {(scannerMessage || scannedRental || lookupCode) && (
                <div className="mt-4 space-y-3">
                  {scannerMessage && (
                    <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
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
                  ) : lookupCode && isResolvingLookup ? (
                    <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                      Looking up rental {lookupCode}...
                    </p>
                  ) : lookupCode ? (
                    <p className="rounded-md border border-[#d9e8dd] bg-[#f4f9f5] p-3 text-sm text-[#45624d]">
                      No rental found for {lookupCode}.
                    </p>
                  ) : null}
                </div>
              )}
            </div>
          </section>

          <section className="w-full max-w-full overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm box-border lg:self-start">
            <div className="rounded-t-md border-b border-slate-200 bg-[linear-gradient(180deg,#f7fbf8_0%,#eef6f0_100%)] px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xl font-medium text-[var(--rf-ink)]">
                  Pending Rentals
                </h2>
                <span className="inline-flex size-9 items-center justify-center rounded-md border border-[#1f7a36] bg-[#1f7a36] text-white">
                  <svg
                    aria-hidden="true"
                    className="size-4 shrink-0"
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                  >
                    <path d="M12 6v6l4 2" />
                    <circle cx="12" cy="12" r="9" />
                  </svg>
                </span>
              </div>
            </div>

            <div className="space-y-2 p-4">
              {pendingRentals.length === 0 && (
                <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                  No pending rentals.
                </p>
              )}
              {pendingRentals.map((rental) => (
                <div
                  className="cursor-pointer rounded-md border border-slate-200 bg-white p-3 text-sm transition hover:border-[#b9d8c3] hover:bg-[#fbfdfb]"
                  key={rental.id}
                  onClick={() => {
                    setScanCode(rental.id);
                    setIsResolvingLookup(false);
                    setScannerMessage("");
                    setOpenPendingMenuId(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setScanCode(rental.id);
                      setIsResolvingLookup(false);
                      setScannerMessage("");
                      setOpenPendingMenuId(null);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <b className="block text-[var(--rf-ink)]">{rental.id}</b>
                      <span className="mt-1 block text-[var(--rf-ink)]/72">
                        {rental.customerName}
                      </span>
                      <span className="mt-2 inline-flex items-center rounded-md bg-[#eef6f0] px-2.5 py-1 text-xs font-bold text-[#355540]">
                        Expires in {formatPendingCountdown(rental, now)}
                      </span>
                    </div>
                    <div className="relative shrink-0">
                      <button
                        aria-expanded={openPendingMenuId === rental.id}
                        aria-haspopup="menu"
                        aria-label={`More actions for ${rental.id}`}
                        className="inline-flex size-9 items-center justify-center rounded-md border border-slate-200 text-[var(--rf-ink)]/55 transition hover:bg-slate-50 hover:text-[var(--rf-ink)]"
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
                            className="flex items-center whitespace-nowrap rounded px-3 py-2 text-left text-sm font-semibold text-red-600 transition hover:bg-red-50"
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
                </div>
              ))}
            </div>
          </section>
        </div>
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
    <div className="mt-4 rounded-md border border-slate-200 bg-white p-4 text-sm shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-xl font-bold text-[var(--rf-ink)]">
            {rental.id}
          </p>
        </div>
        <AdminStatusBadge status={rental.status} />
      </div>
      <dl className="mt-3 divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
        <CompactDetailRow label="Customer" value={rental.customerName} />
        <CompactDetailRow label="Cottage" value={rental.cottageNumber} />
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
        <div className="mt-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Rented items
          </p>
          <div className="mt-2 space-y-2">
            {getRentalItems(rental).map((item, index) => (
              <div
                className="rounded-md border border-slate-200 bg-white px-3 py-2.5"
                key={item.id ?? `${item.floatId}-${index}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <b className="text-[var(--rf-ink)]">{item.floatName}</b>
                  <span className="shrink-0 text-sm font-semibold text-slate-500">
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
            className="h-11 w-full rounded-md border border-slate-200 bg-slate-50 px-4 font-bold text-red-600 transition hover:bg-red-50"
            onClick={() => onCancel(rental.id)}
            type="button"
          >
            Cancel rental
          </button>
          <button
            className="h-11 w-full rounded-md bg-[#1f7a36] px-4 font-bold text-white transition hover:bg-[#17642b]"
            onClick={() => onActivate(rental.id)}
            type="button"
          >
            Activate
          </button>
        </div>
      )}
      {rental.status === "active" && (
        <div className="mt-3 space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Rented items
          </p>
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
              className="h-11 w-full rounded-md bg-[#1f7a36] px-4 font-bold text-white transition hover:bg-[#17642b]"
              onClick={() => onReturn(rental.id)}
              type="button"
            >
              Return all remaining items
            </button>
          )}
        </div>
      )}
      {rental.status === "returned" && (
        <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-slate-600">
          This rental has already been closed.
        </p>
      )}
      {rental.status === "cancelled" && (
        <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-slate-600">
          This pending rental was cancelled and cannot be activated.
        </p>
      )}
      {rental.status === "expired" && (
        <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-slate-600">
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
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <b className="text-[var(--rf-ink)]">{item.floatName}</b>
          <p className="mt-1 text-slate-600">
            {formatRentalDuration(item.durationMinutes)} ·{" "}
            {formatAmountDue(item.subtotal)}
          </p>
          {isRentalItemReturned(item) && (
            <p className="mt-1 text-xs font-semibold text-[var(--rf-blue)]">
              Returned {formatTime(item.returnedAt)}
            </p>
          )}
        </div>
        {!isRentalItemReturned(item) && (
          <button
            className="rounded-md border border-[#1f7a36] bg-[#1f7a36] px-3 py-2 text-xs font-bold text-white transition hover:bg-[#17642b] hover:border-[#17642b]"
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

function AdminStatusBadge({
  status,
}: {
  status: RentalRecord["status"];
}) {
  const styles = {
    pending: "border-[#d7e6db] bg-[#eef6f0] text-[#355540]",
    active: "border-[#cde0d2] bg-[#e6f2e9] text-[#1f7a36]",
    returned: "border-slate-200 bg-slate-100 text-slate-700",
    cancelled: "border-red-200 bg-red-50 text-red-600",
    expired: "border-amber-200 bg-amber-50 text-amber-700",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${styles[status]}`}
    >
      {status}
    </span>
  );
}

function CompactDetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[104px_minmax(0,1fr)] items-center gap-3 px-3 py-2.5">
      <dt className="leading-none text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        {label}
      </dt>
      <dd className="min-w-0 text-right font-semibold leading-none text-[var(--rf-ink)]">
        {value}
      </dd>
    </div>
  );
}
