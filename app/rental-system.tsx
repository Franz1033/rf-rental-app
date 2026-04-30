"use client";

import QRCode from "qrcode";
import Image from "next/image";
import { FormEvent, MouseEvent, useEffect, useMemo, useState } from "react";
import {
  FloatItem,
  PaymentMode,
  QrPass,
  RentalLineItem,
  RentalRecord,
  formatAmountDue,
  formatPeso,
  formatRentalDuration,
  formatRentalPrice,
  getRentalItems,
  getRentalTitle,
  isValidPhilippineMobile,
  normalizePhilippineMobile,
  rules,
  useRentalItems,
  useRentals,
} from "./rental-data";
import { pendingRentalExpirationMs } from "./lib/rental-config";

type CartItem = FloatItem & {
  entryId: string;
  hours: number;
};

type ToastState = {
  id: number;
  message: string;
};

const freeRentalCooldownMs = 24 * 60 * 60 * 1000;
const gcashEnabled = false;
const smsVerificationEnabled = true;
const getCurrentTimestamp = () => new Date().getTime();

const clampCartValue = (value: number, max: number) =>
  Math.max(1, Math.min(max, Math.floor(value)));

const formatPendingExpirationLabel = () => {
  const totalSeconds = Math.floor(pendingRentalExpirationMs / 1000);

  if (totalSeconds % 3600 === 0) {
    const hours = totalSeconds / 3600;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }

  if (totalSeconds % 60 === 0) {
    const minutes = totalSeconds / 60;
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }

  return `${totalSeconds} second${totalSeconds === 1 ? "" : "s"}`;
};

function BrandTitle() {
  return (
    <p className="text-base font-medium tracking-[0.02em] text-[#f7fff8] sm:text-lg">
      Royal Farm Rentals
    </p>
  );
}

export default function RentalSystem() {
  const [floats, refreshItems, isLoadingItems] = useRentalItems();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [step, setStep] = useState<
    "choose" | "rental" | "customer" | "rules" | "qr"
  >("choose");
  const [customerName, setCustomerName] = useState("");
  const [cottageNumber, setCottageNumber] = useState("");
  const [mobile, setMobile] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [hasSentVerificationCode, setHasSentVerificationCode] = useState(false);
  const [verificationMessage, setVerificationMessage] = useState("");
  const [toast, setToast] = useState<ToastState | null>(null);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("Cash");
  const [acceptedRules, setAcceptedRules] = useState(false);
  const [isGeneratingQr, setIsGeneratingQr] = useState(false);
  const [isSendingVerificationCode, setIsSendingVerificationCode] =
    useState(false);
  const [isCheckingVerificationCode, setIsCheckingVerificationCode] =
    useState(false);
  const [isNewRentalModalOpen, setIsNewRentalModalOpen] = useState(false);
  const [rentals, , refreshRentals] = useRentals();
  const [currentRentalId, setCurrentRentalId] = useState<string | null>(null);
  const [currentRentalSnapshot, setCurrentRentalSnapshot] =
    useState<RentalRecord | null>(null);

  const currentRental = useMemo(
    () =>
      rentals.find((rental) => rental.id === currentRentalId) ??
      (currentRentalSnapshot?.id === currentRentalId
        ? currentRentalSnapshot
        : null),
    [currentRentalId, currentRentalSnapshot, rentals],
  );
  const normalizedMobile = normalizePhilippineMobile(mobile);
  const hasFreeItem = cart.some((item) => item.price === 0);
  const hasPaidItem = cart.some((item) => item.price > 0);
  const totalAmount = cart.reduce(
    (sum, item) => sum + item.price * item.hours,
    0,
  );
  const totalQuantity = cart.length;
  const damageFeeItems = useMemo(() => {
    const grouped = new Map<
      string,
      { name: string; damageFee: number; quantity: number }
    >();

    for (const item of cart) {
      const current = grouped.get(item.id);

      if (current) {
        current.quantity += 1;
        continue;
      }

      grouped.set(item.id, {
        name: item.name,
        damageFee: item.damageFee,
        quantity: 1,
      });
    }

    return Array.from(grouped.values());
  }, [cart]);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setToast((current) => (current?.id === toast.id ? null : current));
    }, 2400);

    return () => window.clearTimeout(timeoutId);
  }, [toast]);

  const getFreeCooldownMessage = (timestamp: number) => {
    if (!hasFreeItem || !normalizedMobile) {
      return "";
    }

    const cutoff = timestamp - freeRentalCooldownMs;
    const freeCooldownRental = rentals.find(
      (rental) =>
        rental.paymentMode === "Free" &&
        rental.status !== "cancelled" &&
        rental.status !== "expired" &&
        normalizePhilippineMobile(rental.mobile) === normalizedMobile &&
        rental.createdAt > cutoff,
    );

    return freeCooldownRental
      ? `This mobile number already claimed a free 1-hour rental within the last 24 hours. It can claim again after ${new Intl.DateTimeFormat(
          "en-PH",
          {
            hour: "numeric",
            minute: "2-digit",
            month: "short",
            day: "numeric",
          },
        ).format(freeCooldownRental.createdAt + freeRentalCooldownMs)}.`
      : "";
  };

  const addToCart = (float: FloatItem) => {
    setCart((current) => {
      const selectedCount = current.filter(
        (item) => item.id === float.id,
      ).length;

      if (selectedCount >= float.availableQuantity) {
        const remainingCount = Math.max(float.availableQuantity, 0);
        const limitMessage =
          remainingCount <= 0
            ? `${float.name} is currently unavailable.`
            : `Only ${remainingCount} ${remainingCount === 1 ? "item" : "items"} of ${float.name} ${remainingCount === 1 ? "is" : "are"} available right now.`;
        setToast({
          id: Date.now(),
          message: limitMessage,
        });
        return current;
      }

      return [
        ...current,
        {
          ...float,
          entryId: `${float.id}-${crypto.randomUUID()}`,
          hours: 1,
        },
      ];
    });
  };

  const removeFromCart = (entryId: string) => {
    setCart((current) => {
      const nextCart = current.filter((item) => item.entryId !== entryId);

      if (nextCart.length === 0) {
        setStep("choose");
      }

      return nextCart;
    });
  };

  const updateCartItem = (
    entryId: string,
    patch: Partial<Pick<CartItem, "hours">>,
  ) => {
    setCart((current) =>
      current.map((item) => {
        if (item.entryId !== entryId) {
          return item;
        }

        if (item.price === 0) {
          return {
            ...item,
            hours: 1,
          };
        }

        const requestedHours = patch.hours ?? item.hours;
        const nextHours = clampCartValue(requestedHours, item.maxHours);

        if (requestedHours > item.maxHours) {
          setToast({
            id: Date.now(),
            message: `${item.name} can only be rented up to ${item.maxHours} hour${item.maxHours === 1 ? "" : "s"}.`,
          });
        }

        return {
          ...item,
          hours: nextHours,
        };
      }),
    );
  };

  const resetCheckout = () => {
    setCart([]);
    setCustomerName("");
    setCottageNumber("");
    setMobile("");
    setVerificationCode("");
    setHasSentVerificationCode(false);
    setVerificationMessage("");
    setPaymentMode("Cash");
    setAcceptedRules(false);
    setIsGeneratingQr(false);
    setIsSendingVerificationCode(false);
    setIsCheckingVerificationCode(false);
    setIsNewRentalModalOpen(false);
    setCurrentRentalId(null);
    setCurrentRentalSnapshot(null);
    setStep("choose");
  };

  const submitDetails = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (cart.length === 0) {
      return;
    }

    if (!cottageNumber.trim()) {
      setVerificationMessage("Enter the customer's cottage number.");
      return;
    }

    if (!isValidPhilippineMobile(mobile)) {
      setVerificationMessage(
        "Enter a valid PH mobile number, e.g. 0917 123 4567.",
      );
      return;
    }

    const freeCooldownMessage = getFreeCooldownMessage(getCurrentTimestamp());

    if (freeCooldownMessage) {
      setVerificationMessage(freeCooldownMessage);
      return;
    }

    if (smsVerificationEnabled) {
      if (!hasSentVerificationCode) {
        setVerificationMessage("Send a verification code first.");
        return;
      }

      setIsCheckingVerificationCode(true);

      const response = await fetch("/api/verify/check", {
        body: JSON.stringify({
          code: verificationCode,
          mobile: normalizedMobile,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const body = (await response.json().catch(() => ({}))) as {
        message?: string;
        verified?: boolean;
      };

      setIsCheckingVerificationCode(false);

      if (!response.ok || !body.verified) {
        setVerificationMessage(
          body.message ?? "Verification code does not match.",
        );
        return;
      }
    }

    setVerificationMessage("");
    setStep("rules");
  };

  const sendVerificationCode = async () => {
    if (!isValidPhilippineMobile(mobile)) {
      setVerificationMessage(
        "Enter a valid PH mobile number, e.g. 0917 123 4567.",
      );
      return;
    }

    const freeCooldownMessage = getFreeCooldownMessage(getCurrentTimestamp());

    if (freeCooldownMessage) {
      setVerificationMessage(freeCooldownMessage);
      return;
    }

    setIsSendingVerificationCode(true);

    const response = await fetch("/api/verify/send", {
      body: JSON.stringify({ mobile: normalizedMobile }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    const body = (await response.json().catch(() => ({}))) as {
      message?: string;
    };

    setIsSendingVerificationCode(false);

    if (!response.ok) {
      setHasSentVerificationCode(false);
      setVerificationMessage(
        body.message ?? "Unable to send verification code.",
      );
      return;
    }

    setHasSentVerificationCode(true);
    setVerificationCode("");
    setVerificationMessage(
      body.message ?? `Verification code sent to ${normalizedMobile}.`,
    );
  };

  const createQrPass = async (event: MouseEvent<HTMLButtonElement>) => {
    if (cart.length === 0 || !acceptedRules || isGeneratingQr) {
      return;
    }

    setIsGeneratingQr(true);

    const timestamp = Math.floor(event.timeStamp + performance.timeOrigin);
    const id = `RF-${timestamp.toString(36).toUpperCase()}`;
    const items: RentalLineItem[] = cart.map((item) => ({
      floatId: item.id,
      floatName: item.name,
      price: item.price,
      quantity: 1,
      durationMinutes: item.hours * 60,
      subtotal: item.price * item.hours,
    }));
    const firstItem = items[0];
    const durationMinutes = Math.max(
      ...items.map((item) => item.durationMinutes),
    );
    const payment = totalAmount === 0 ? "Free" : paymentMode;
    const rentalTitle = getRentalTitle({
      id,
      floatId: firstItem.floatId,
      floatName: firstItem.floatName,
      price: firstItem.price,
      items,
      customerName,
      cottageNumber,
      mobile: normalizedMobile,
      verificationCode,
      paymentMode: payment,
      amountDue: totalAmount,
      status: "pending",
      createdAt: timestamp,
      durationMinutes,
    });

    const rental: RentalRecord = {
      id,
      floatId: firstItem.floatId,
      floatName: rentalTitle,
      price: firstItem.price,
      items,
      customerName,
      cottageNumber,
      mobile: normalizedMobile,
      verificationCode,
      paymentMode: payment,
      amountDue: totalAmount,
      status: "pending",
      createdAt: timestamp,
      durationMinutes,
    };

    const response = await fetch("/api/rentals", {
      body: JSON.stringify(rental),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        message?: string;
      };
      setIsGeneratingQr(false);
      setVerificationMessage(
        body.message ?? "Unable to save this rental. Please try again.",
      );
      setStep("customer");
      return;
    }

    const savedRental = (await response.json()) as RentalRecord;
    setCurrentRentalSnapshot(savedRental);
    await Promise.all([refreshRentals(), refreshItems()]);
    setCurrentRentalId(savedRental.id);
    setIsGeneratingQr(false);
    setStep("qr");
  };

  const saveQrImage = async (rental: RentalRecord) => {
    const dataUrl = await QRCode.toDataURL(rental.id, {
      errorCorrectionLevel: "M",
      margin: 2,
      scale: 10,
    });
    const qrImage = new window.Image();
    const imageLoaded = new Promise<void>((resolve, reject) => {
      qrImage.onload = () => resolve();
      qrImage.onerror = () => reject(new Error("Unable to load QR image."));
    });

    qrImage.src = dataUrl;
    await imageLoaded;

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Unable to create QR image.");
    }

    const canvasWidth = 520;
    const canvasHeight = 660;
    const qrSize = 360;
    const qrX = Math.round((canvasWidth - qrSize) / 2);
    const qrY = 92;

    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvasWidth, canvasHeight);

    context.fillStyle = "#64748b";
    context.font = "600 24px Arial, sans-serif";
    context.textAlign = "center";
    context.fillText("Royal Farm · Rental Code", canvasWidth / 2, 48);

    context.drawImage(qrImage, qrX, qrY, qrSize, qrSize);

    context.fillStyle = "#020617";
    context.font = "700 38px Arial, sans-serif";
    context.fillText(rental.id, canvasWidth / 2, qrY + qrSize + 84);

    const link = document.createElement("a");
    link.download = `${rental.id}-qr.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  const confirmNewRental = () => {
    setIsNewRentalModalOpen(true);
  };

  const showItemSkeletons = isLoadingItems && floats.length === 0;

  return (
    <main className="min-h-screen bg-[#f5f5f5] text-[var(--rf-ink)]">
      <section className="mx-auto flex w-full max-w-5xl flex-col gap-0 px-0 py-0">
        {step === "choose" ? (
          <>
            <section className="mx-4 mt-4 overflow-hidden rounded-md border border-[#ebebeb] bg-white shadow-sm sm:mx-6">
              <header className="bg-[linear-gradient(180deg,#3fa55b_0%,#2f8f49_62%,#1f7a36_100%)] px-5 py-4 text-white">
                <BrandTitle />
              </header>

              <div className="p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h2 className="text-2xl font-bold leading-tight text-[#222]">
                    Rental Cart
                  </h2>
                  <p className="text-sm text-[#666]">
                    {totalQuantity} item{totalQuantity === 1 ? "" : "s"}{" "}
                    selected
                  </p>
                </div>
                <span className="grid size-12 shrink-0 place-items-center rounded-sm bg-[#e7f4ea] text-[#1f7a36]">
                  <svg
                    aria-hidden="true"
                    className="size-5"
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                  >
                    <circle cx="8" cy="21" r="1" />
                    <circle cx="19" cy="21" r="1" />
                    <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h8.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
                  </svg>
                </span>
              </div>
              {cart.length === 0 ? (
                <p className="mt-4 rounded-sm bg-[#edf5ef] p-3 text-sm text-[#3f5946]">
                  Add to cart an item to continue.
                </p>
              ) : (
                <div className="mt-4 space-y-2">
                  {cart.map((item) => (
                    <div
                      className="flex items-center justify-between gap-3 rounded-sm border border-[#f0f0f0] bg-white p-3 text-sm"
                      key={item.entryId}
                    >
                      <div>
                        <b className="text-base text-[#222]">{item.name}</b>
                        <p className="text-[var(--rf-ink)]/72">
                          {formatRentalDuration(item.hours * 60)} ·{" "}
                          {formatAmountDue(item.price * item.hours)}
                        </p>
                      </div>
                      <button
                        className="rounded-sm border border-[#aacfb4] px-3 py-2 text-xs font-bold text-[#1f7a36]"
                        onClick={() => removeFromCart(item.entryId)}
                        type="button"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <button
                className="mt-5 h-12 w-full rounded-sm bg-[#1f7a36] px-4 font-bold text-white transition hover:bg-[#17642b] disabled:bg-[#9fbea8]"
                disabled={cart.length === 0}
                onClick={() => setStep("rental")}
                type="button"
              >
                Continue
              </button>
              </div>
            </section>

            {showItemSkeletons ? (
              <section
                aria-label="Loading rental items"
                className="mt-4 grid gap-3 sm:grid-cols-2"
              >
                {Array.from({ length: 4 }, (_, index) => (
                  <article
                    aria-hidden="true"
                    className="overflow-hidden rounded-md border border-[#eeeeee] bg-white text-left shadow-sm"
                    key={`rental-skeleton-${index}`}
                  >
                    <div className="aspect-[4/3] animate-pulse bg-slate-200" />
                    <div className="space-y-3 p-4">
                      <div className="h-7 w-3/5 animate-pulse rounded bg-slate-200" />
                      <div className="h-5 w-2/5 animate-pulse rounded bg-slate-100" />
                      <div className="h-5 w-1/4 animate-pulse rounded bg-slate-100" />
                      <div className="h-11 w-full animate-pulse rounded-md bg-slate-200" />
                    </div>
                  </article>
                ))}
              </section>
            ) : floats.length === 0 ? (
              <section className="mt-4 rounded-md border border-dashed border-[#dddddd] bg-white p-6 text-center text-sm text-slate-600 shadow-sm">
                No rental items are available yet.
              </section>
            ) : (
              <section className="mt-4 px-4 pb-4 sm:px-6 sm:pb-6">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {floats.map((float) => {
                  const selectedCount = cart.filter(
                    (item) => item.id === float.id,
                  ).length;
                  const remainingQuantity = Math.max(
                    float.availableQuantity - selectedCount,
                    0,
                  );
                  const pendingQuantity = Math.max(float.pendingQuantity, 0);
                  const hasNoInventoryLeft = float.availableQuantity <= 0;
                  const hasSelectedAllAvailable =
                    float.availableQuantity > 0 && remainingQuantity <= 0;
                  const disableAddToCart =
                    hasNoInventoryLeft || hasSelectedAllAvailable;
                  const availabilityLabel = hasNoInventoryLeft
                    ? pendingQuantity > 0
                      ? "Pending transaction"
                      : "Currently unavailable"
                    : hasSelectedAllAvailable
                      ? pendingQuantity > 0
                        ? "All available items selected, others pending"
                        : "All available items selected"
                      : pendingQuantity > 0
                        ? `${remainingQuantity} available • ${pendingQuantity} pending`
                        : `${remainingQuantity} available`;

                  return (
                    <article
                      className="overflow-hidden rounded-sm border border-[#ebebeb] bg-white text-left shadow-sm transition hover:border-[#aacfb4] hover:shadow-md"
                      key={float.id}
                    >
                      <span className="group relative block aspect-[4/3] overflow-hidden bg-slate-100">
                        <Image
                          alt={float.name}
                          className="object-cover transition duration-300 ease-out group-hover:scale-105 group-hover:brightness-95"
                          fill
                          sizes="(min-width: 640px) 50vw, 100vw"
                          src={float.imageUrl}
                        />
                        <span className="pointer-events-none absolute inset-0 bg-[var(--rf-ink)]/0 transition duration-300 group-hover:bg-[var(--rf-blue)]/18" />
                      </span>
                      <span className="block p-3.5">
                        <span className="line-clamp-2 block min-h-[2.75rem] text-lg font-bold leading-snug text-[#222]">
                          {float.name}
                        </span>
                        <span className="mt-1 block text-base font-bold text-[#1f7a36]">
                          {formatRentalPrice(float.price)}
                        </span>
                        <span className="mt-1 block text-xs text-[#777]">
                          {availabilityLabel}
                        </span>
                        <button
                          className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-sm bg-[#1f7a36] px-4 text-sm font-bold text-white transition hover:bg-[#17642b] focus:outline-none focus:ring-2 focus:ring-[#1f7a36] focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-[#9fbea8]"
                          disabled={disableAddToCart}
                          onClick={() => addToCart(float)}
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
                            <circle cx="8" cy="21" r="1" />
                            <circle cx="19" cy="21" r="1" />
                            <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h8.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
                          </svg>
                          {hasNoInventoryLeft
                            ? "Unavailable"
                            : hasSelectedAllAvailable
                              ? "Selected all available"
                              : selectedCount > 0
                                ? `Selected ${selectedCount}`
                                : "Add to cart"}
                        </button>
                      </span>
                    </article>
                  );
                })}
                </div>
              </section>
            )}
          </>
        ) : step === "rental" || step === "customer" || step === "rules" || step === "qr" ? null : (
          <header className="mx-4 mt-4 rounded-md bg-[linear-gradient(180deg,#3fa55b_0%,#2f8f49_62%,#1f7a36_100%)] px-5 py-4 text-white sm:mx-6">
            <BrandTitle />
          </header>
        )}

        {step === "rental" && cart.length > 0 && (
          <section className="mx-4 mt-4 overflow-hidden rounded-md border border-[#ebebeb] bg-white shadow-sm sm:mx-6">
            <header className="bg-[linear-gradient(180deg,#3fa55b_0%,#2f8f49_62%,#1f7a36_100%)] px-5 py-4 text-white">
              <BrandTitle />
            </header>

            <div className="p-4">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-2xl font-bold">Rental Details</h2>
                <p className="text-sm text-[#666]">
                  {totalQuantity} item{totalQuantity === 1 ? "" : "s"} selected
                </p>
              </div>
              <button
                className="rounded-sm border border-[#aacfb4] px-3 py-2 text-sm font-semibold text-[#1f7a36]"
                onClick={() => setStep("choose")}
                type="button"
              >
                Change
              </button>
            </div>

            <div className="mb-4 space-y-3">
              {cart.map((item, index) => (
                <div
                  className="rounded-sm border border-[#eeeeee] bg-white p-4"
                  key={item.entryId}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <b className="block text-base">{item.name}</b>
                      <p className="text-sm text-[#666]">
                        Unit {index + 1} · {formatRentalPrice(item.price)}
                      </p>
                    </div>
                    <button
                      className="shrink-0 rounded-sm border border-[#c1dcc9] px-2.5 py-1.5 text-xs font-medium text-[#1f7a36] transition hover:bg-[#edf5ef] hover:text-[#17642b]"
                      onClick={() => removeFromCart(item.entryId)}
                      type="button"
                    >
                      Remove
                    </button>
                  </div>
                  <div className="mt-4 flex items-end justify-between gap-6">
                    <div className="flex items-center overflow-hidden rounded-sm border border-[#eeeeee] bg-white">
                      <button
                        aria-label={`Decrease hours for ${item.name}`}
                        className="grid h-10 w-10 place-items-center text-lg font-semibold text-[#444] transition hover:bg-[#edf5ef] disabled:cursor-not-allowed disabled:text-slate-300"
                        disabled={item.price === 0 || item.hours <= 1}
                        onClick={() =>
                          updateCartItem(item.entryId, {
                            hours: item.hours - 1,
                          })
                        }
                        type="button"
                      >
                        -
                      </button>
                      <span className="grid h-10 min-w-20 place-items-center border-x border-[#eeeeee] bg-white px-3 text-sm font-bold text-[#222]">
                        {item.hours} hr{item.hours === 1 ? "" : "s"}
                      </span>
                      <button
                        aria-label={`Increase hours for ${item.name}`}
                        className="grid h-10 w-10 place-items-center text-lg font-semibold text-[#444] transition hover:bg-[#edf5ef] disabled:cursor-not-allowed disabled:text-slate-300"
                        disabled={
                          item.price === 0 || item.hours >= item.maxHours
                        }
                        onClick={() =>
                          updateCartItem(item.entryId, {
                            hours: item.hours + 1,
                          })
                        }
                        type="button"
                      >
                        +
                      </button>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-[#aaa]">
                        Subtotal
                      </p>
                      <b className="text-base font-semibold text-[#6b4a3a]">
                        {formatAmountDue(item.price * item.hours)}
                      </b>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-sm bg-[#f4f9f5] px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-normal text-[#3f5946]">
                    Total amount due
                  </p>
                </div>
                <b className="text-xl font-semibold leading-none text-[#1f7a36]">
                  {formatAmountDue(totalAmount)}
                </b>
              </div>
            </div>

            <button
              className="mt-4 h-12 w-full rounded-sm bg-[#1f7a36] px-4 font-bold text-white transition hover:bg-[#17642b] disabled:bg-[#9fbea8]"
              disabled={cart.length === 0}
              onClick={() => setStep("customer")}
              type="button"
            >
              Continue
            </button>
            </div>
          </section>
        )}

        {step === "customer" && cart.length > 0 && (
          <section className="mx-4 mt-4 overflow-hidden rounded-md border border-[#ebebeb] bg-white shadow-sm sm:mx-6">
            <header className="bg-[linear-gradient(180deg,#3fa55b_0%,#2f8f49_62%,#1f7a36_100%)] px-5 py-4 text-white">
              <BrandTitle />
            </header>

            <div className="p-4">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-bold">Customer Details</h2>
                  <p className="text-sm text-[#666]">
                    {totalQuantity} item{totalQuantity === 1 ? "" : "s"} selected
                  </p>
                </div>
                <button
                  className="rounded-sm border border-[#aacfb4] px-3 py-2 text-sm font-semibold text-[#1f7a36]"
                  onClick={() => setStep("rental")}
                  type="button"
                >
                  Back
                </button>
              </div>

              <form className="space-y-4" onSubmit={submitDetails}>
              <label className="block text-sm font-semibold">
                Full name
                <input
                  className="mt-2 h-12 w-full rounded-md border border-[#dddddd] bg-white px-3 text-base outline-none focus:border-[#bbbbbb]"
                  onChange={(event) => setCustomerName(event.target.value)}
                  placeholder="Enter full name"
                  required
                  value={customerName}
                />
              </label>
              <label className="block text-sm font-semibold">
                Cottage number
                <input
                  className="mt-2 h-12 w-full rounded-md border border-[#dddddd] bg-white px-3 text-base outline-none focus:border-[#bbbbbb]"
                  onChange={(event) => {
                    setCottageNumber(event.target.value);
                    setVerificationMessage("");
                  }}
                  placeholder="Enter cottage number"
                  required
                  value={cottageNumber}
                />
              </label>
              <label className="block text-sm font-semibold">
                Mobile number
                <input
                  className="mt-2 h-12 w-full rounded-md border border-[#dddddd] bg-white px-3 text-base outline-none focus:border-[#bbbbbb]"
                  inputMode="tel"
                  maxLength={13}
                  onChange={(event) => {
                    setMobile(event.target.value);
                    setHasSentVerificationCode(false);
                    setVerificationCode("");
                    setVerificationMessage("");
                  }}
                  placeholder="09XX XXX XXXX"
                  required
                  value={mobile}
                />
              </label>
              {smsVerificationEnabled ? (
                <label className="block text-sm font-semibold">
                  Mobile verification code
                  <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px]">
                    <input
                      className="h-12 w-full rounded-md border border-[#dddddd] bg-white px-3 text-base outline-none focus:border-[#bbbbbb]"
                      inputMode="numeric"
                      maxLength={6}
                      onChange={(event) => {
                        setVerificationCode(event.target.value);
                        if (verificationMessage.includes("does not match")) {
                          setVerificationMessage("");
                        }
                      }}
                      placeholder="Enter SMS code"
                      required
                      value={verificationCode}
                    />
                    <button
                      className="h-12 rounded-md border border-[var(--rf-blue)]/30 bg-[color:color-mix(in_srgb,var(--rf-yellow)_30%,white)] px-4 text-sm font-bold text-[var(--rf-ink)] disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={!mobile.trim() || isSendingVerificationCode}
                      onClick={sendVerificationCode}
                      type="button"
                    >
                      {isSendingVerificationCode ? "Sending..." : "Send code"}
                    </button>
                  </div>
                  {verificationMessage && (
                    <span
                      className={`mt-2 block text-xs font-semibold ${
                        hasSentVerificationCode &&
                        verificationMessage.startsWith("Verification code")
                          ? "text-[var(--rf-blue-deep)]"
                          : "text-[var(--rf-orange-deep)]"
                      }`}
                    >
                      {verificationMessage}
                    </span>
                  )}
                </label>
              ) : (
                verificationMessage && (
                  <span className="block text-xs font-semibold text-[var(--rf-orange-deep)]">
                    {verificationMessage}
                  </span>
                )
              )}

              {hasFreeItem && (
                <div className="rounded-md bg-[color:color-mix(in_srgb,var(--rf-blue)_18%,white)] p-3 text-sm font-semibold text-[var(--rf-ink)]">
                  Free items are limited to 1 hour and 1 quantity per verified
                  mobile number every 24 hours.
                </div>
              )}

              {hasPaidItem && (
                <fieldset className="space-y-2">
                  <legend className="text-sm font-semibold">
                    Mode of payment
                  </legend>
                  <div className="grid grid-cols-2 gap-2">
                    {(["Cash", "GCash"] as PaymentMode[]).map((mode) => (
                      <label
                        className={`flex h-12 items-center justify-center rounded-md border text-sm font-semibold ${
                          paymentMode === mode
                            ? "border-[var(--rf-blue)] bg-[color:color-mix(in_srgb,var(--rf-blue)_18%,white)] text-[var(--rf-ink)]"
                            : "border-slate-200"
                        } ${
                          mode === "GCash" && !gcashEnabled
                            ? "cursor-not-allowed opacity-50"
                            : ""
                        }`}
                        key={mode}
                      >
                        <input
                          checked={paymentMode === mode}
                          className="sr-only"
                          disabled={mode === "GCash" && !gcashEnabled}
                          onChange={() => setPaymentMode(mode)}
                          type="radio"
                        />
                        {mode}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}

              <div className="rounded-sm bg-[#f4f9f5] px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-normal text-[#3f5946]">
                      Total amount due
                    </p>
                  </div>
                  <b className="text-xl font-semibold leading-none text-[#1f7a36]">
                    {formatAmountDue(totalAmount)}
                  </b>
                </div>
              </div>

              <button
              className="h-12 w-full rounded-sm bg-[#1f7a36] px-4 font-bold text-white transition hover:bg-[#17642b] disabled:bg-[#9fbea8]"
                disabled={isCheckingVerificationCode}
                type="submit"
              >
                {isCheckingVerificationCode ? "Checking..." : "Continue"}
              </button>
              </form>
            </div>
          </section>
        )}

        {step === "rules" && cart.length > 0 && (
          <section className="mx-4 mt-4 overflow-hidden rounded-md border border-[#ebebeb] bg-white shadow-sm sm:mx-6">
            <header className="bg-[linear-gradient(180deg,#3fa55b_0%,#2f8f49_62%,#1f7a36_100%)] px-5 py-4 text-white">
              <BrandTitle />
            </header>

            <div className="p-4">
              <div className="flex items-start justify-between gap-3">
                <h2 className="mt-1 text-2xl font-bold">Guidelines and Fees</h2>
                <button
                  className="rounded-sm border border-[#aacfb4] px-3 py-2 text-sm font-semibold text-[#1f7a36]"
                  onClick={() => setStep("customer")}
                  type="button"
                >
                  Back
                </button>
              </div>
              <div className="mt-4 space-y-2">
                {damageFeeItems.map((item) => (
                  <div
                    className="rounded-sm bg-[color:color-mix(in_srgb,var(--rf-orange)_12%,white)] px-4 py-3 text-sm text-[var(--rf-ink)]"
                    key={item.name}
                  >
                    <span className="font-medium">Lost or damaged {item.name}:</span>{" "}
                    <b>{formatPeso(item.damageFee)}</b> each
                    {item.quantity > 1 ? ` (${item.quantity} selected)` : ""}
                  </div>
                ))}
              </div>
              <ul className="mt-4 space-y-3">
                {rules.map((rule) => (
                  <li
                    className="flex gap-3 rounded-sm border border-[#f1f1f1] p-3 text-sm text-[#555]"
                    key={rule}
                  >
                    <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-[color:color-mix(in_srgb,var(--rf-yellow)_55%,white)] text-[var(--rf-orange-deep)]">
                      <svg
                        aria-hidden="true"
                        className="size-3"
                        fill="none"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2.25"
                        viewBox="0 0 24 24"
                      >
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    {rule}
                  </li>
                ))}
              </ul>
              <label className="mt-4 flex items-center gap-3 text-sm font-semibold leading-5">
                <input
                  checked={acceptedRules}
                  className="size-5 shrink-0"
                  onChange={(event) => setAcceptedRules(event.target.checked)}
                  type="checkbox"
                />
                I understand and agree to these rental terms.
              </label>
              <button
                className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-sm bg-[#1f7a36] px-4 font-bold text-white transition hover:bg-[#17642b] disabled:bg-[#9fbea8]"
                disabled={!acceptedRules || isGeneratingQr}
                onClick={createQrPass}
                type="button"
              >
                {isGeneratingQr && (
                  <span className="size-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                )}
                Confirm
              </button>
            </div>
          </section>
        )}

        {step === "qr" && currentRental && (
          <section className="mx-4 mt-4 overflow-hidden rounded-md border border-[#ebebeb] bg-white shadow-sm sm:mx-6">
            <header className="bg-[linear-gradient(180deg,#3fa55b_0%,#2f8f49_62%,#1f7a36_100%)] px-5 py-4 text-white">
              <BrandTitle />
            </header>
            <div className="p-4 text-center">
            <h2 className="mt-1 text-2xl font-bold">{currentRental.id}</h2>
            <p className="mt-1 text-sm text-[#666]">
              Present QR code to cashier (expires in{" "}
              {formatPendingExpirationLabel()})
            </p>
            <div className="my-5">
              <QrPass rental={currentRental} />
            </div>
            <div className="rounded-sm bg-[#fafafa] p-4 text-left text-sm">
              <div className="flex justify-between gap-3">
                <span>Customer</span>
                <b>{currentRental.customerName}</b>
              </div>
              <div className="mt-2 flex justify-between gap-3">
                <span>Cottage no.</span>
                <b>{currentRental.cottageNumber}</b>
              </div>
              <div className="mt-2 flex justify-between gap-3">
                <span>Items</span>
                <b>{getRentalTitle(currentRental)}</b>
              </div>
              <div className="mt-3 space-y-2">
                {getRentalItems(currentRental).map((item, index) => (
                  <div
                    className="rounded-sm border border-[#eeeeee] p-3"
                    key={`${item.floatId}-${index}`}
                  >
                    <b>{item.floatName}</b>
                    <p className="text-[#666]">
                      {formatRentalDuration(item.durationMinutes)} ·{" "}
                      {formatAmountDue(item.subtotal)}
                    </p>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex justify-between gap-3">
                <span>Amount due</span>
                <b>{formatAmountDue(currentRental.amountDue)}</b>
              </div>
            </div>
            <button
              className="mt-4 h-12 w-full rounded-sm bg-[#1f7a36] px-4 font-bold text-white transition hover:bg-[#17642b]"
              onClick={() => saveQrImage(currentRental)}
              type="button"
            >
              Save QR image
            </button>
            <button
              className="mt-3 h-12 w-full rounded-sm border border-[#dddddd] px-4 font-bold text-[#555]"
              onClick={confirmNewRental}
              type="button"
            >
              New rental
            </button>
            </div>
          </section>
        )}
      </section>
      {step === "choose" && cart.length > 0 && (
        <button
          type="button"
          onClick={() =>
            window.scrollTo({
              top: 0,
              behavior: "smooth",
            })
          }
          className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-[var(--rf-blue)] px-5 py-3 text-sm font-bold text-white shadow-xl transition hover:-translate-y-1 hover:bg-[var(--rf-blue-deep)]"
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
            <circle cx="8" cy="21" r="1" />
            <circle cx="19" cy="21" r="1" />
            <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h8.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
          </svg>
          View Cart ({cart.length})
        </button>
      )}
      {toast && (
        <div className="pointer-events-none fixed inset-x-4 top-4 z-50 flex justify-center">
          <div className="w-full max-w-sm rounded-md bg-[var(--rf-ink)] px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-[color:color-mix(in_srgb,var(--rf-blue)_30%,#000)]">
            {toast.message}
          </div>
        </div>
      )}
      {isNewRentalModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[color:color-mix(in_srgb,var(--rf-ink)_55%,transparent)] px-4"
          onClick={() => setIsNewRentalModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-md bg-white p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="min-w-0">
              <h3 className="text-xl font-bold text-[var(--rf-ink)]">
                Start a new rental?
              </h3>
              <p className="mt-2 text-sm leading-6 text-[#5c6f62]">
                Please make sure you have saved this QR image or shown this QR
                pass before continuing.
              </p>
            </div>
            <div className="mt-5 flex flex-col gap-2">
              <button
                className="h-11 rounded-sm bg-[#1f7a36] px-4 text-sm font-bold text-white transition hover:bg-[#17642b]"
                onClick={resetCheckout}
                type="button"
              >
                Start new rental
              </button>
              <button
                className="h-11 rounded-sm border border-[#dddddd] px-4 text-sm font-semibold text-[#555] transition hover:bg-[#f7f7f7]"
                onClick={() => setIsNewRentalModalOpen(false)}
                type="button"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
