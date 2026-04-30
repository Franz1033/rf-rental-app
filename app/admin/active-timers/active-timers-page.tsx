"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getServerNow,
  RentalLineItem,
  RentalRecord,
  formatAmountDue,
  formatRentalDuration,
  formatRentalDurationSummary,
  formatTime,
  getOpenRentalItems,
  getRentalItems,
  getRentalTitle,
  isRentalFullyReturned,
  isRentalItemReturned,
  itemSecondsLeft,
  minutesLeft,
  secondsLeft,
  useRentals,
  useServerNow,
} from "@/app/rental-data";
import {
  claimAdminPickupLock,
  claimReminderLock,
  getDueReminderItems,
  releaseAdminPickupLock,
  releaseReminderLock,
  sendAdminPickupNotification,
  sendRentalNotification,
} from "../rental-notifications";

type ActiveTimerEntry = {
  key: string;
  item: RentalLineItem;
  itemIndex: number;
  rental: RentalRecord;
};

function getTimerTone(totalSeconds: number) {
  if (totalSeconds === 0) {
    return {
      chipClass: "bg-[color:color-mix(in_srgb,var(--rf-orange)_18%,white)] text-[var(--rf-orange-deep)]",
      labelClass: "text-[var(--rf-orange-deep)]",
      progressClass: "bg-[var(--rf-orange)]",
      title: "Ended",
    };
  }

  if (totalSeconds <= 15 * 60) {
    return {
      chipClass: "bg-[color:color-mix(in_srgb,var(--rf-yellow)_68%,white)] text-[var(--rf-ink)]",
      labelClass: "text-[var(--rf-ink)]",
      progressClass: "bg-[var(--rf-yellow)]",
      title: "Due soon",
    };
  }

  return {
    chipClass: "bg-[color:color-mix(in_srgb,var(--rf-blue)_25%,white)] text-[var(--rf-ink)]",
    labelClass: "text-[var(--rf-ink)]",
    progressClass: "bg-[var(--rf-blue)]",
    title: "Time left",
  };
}

export default function ActiveTimersPage() {
  const [rentals, updateRentals] = useRentals();
  const [selectedTimerId, setSelectedTimerId] = useState<string | null>(null);
  const now = useServerNow();

  useEffect(() => {
    if (!now) {
      return;
    }

    rentals
      .filter(
        (rental) =>
          rental.status === "active" &&
          !rental.smsSentAt &&
          minutesLeft(rental, now) <= 15,
      )
      .forEach((rental) => {
        if (!claimReminderLock(rental.id)) {
          return;
        }

        const dueItems = getDueReminderItems(rental, now);

        if (dueItems.length === 0) {
          releaseReminderLock(rental.id);
          return;
        }

        void sendRentalNotification("reminder", rental, undefined, dueItems)
          .then(() => {
            updateRentals((current) =>
              current.map((entry) =>
                entry.id === rental.id && !entry.smsSentAt
                  ? { ...entry, smsSentAt: now }
                  : entry,
              ),
            );
          })
          .catch(() => {});
      });
  }, [now, rentals, updateRentals]);

  useEffect(() => {
    if (!now) {
      return;
    }

    rentals
      .filter(
        (rental) =>
          rental.status === "active" &&
          !rental.adminPickupAlertSentAt &&
          getOpenRentalItems(rental).length > 0 &&
          secondsLeft(rental, now) === 0,
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
                  ? { ...entry, adminPickupAlertSentAt: now }
                  : entry,
              ),
            );
          })
          .catch(() => {});
      });
  }, [now, rentals, updateRentals]);

  const activeRentals = rentals.filter(
    (rental) =>
      rental.status === "active" && getOpenRentalItems(rental).length > 0,
  );
  const activeTimerEntries = useMemo<ActiveTimerEntry[]>(
    () =>
      activeRentals.flatMap((rental) =>
        getOpenRentalItems(rental).map((item, itemIndex) => ({
          key: `${rental.id}-${item.id ?? itemIndex}`,
          item,
          itemIndex,
          rental,
        })),
      ),
    [activeRentals],
  );
  const selectedTimerRental = useMemo(
    () => rentals.find((rental) => rental.id === selectedTimerId) ?? null,
    [rentals, selectedTimerId],
  );

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
    setSelectedTimerId(null);
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

  return (
    <section className="space-y-5">
      <section className="rounded-xl border border-[var(--rf-blue)]/28 bg-white/92 p-4 shadow-[0_10px_24px_rgba(81,154,102,0.12)]">
        <h2 className="text-lg font-bold text-[var(--rf-ink)]">Active Rentals</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {activeTimerEntries.length === 0 && (
            <p className="rounded-lg bg-[color:color-mix(in_srgb,var(--rf-yellow)_42%,white)] p-3 text-sm text-[var(--rf-ink)]/75 md:col-span-2">
              No active rentals yet.
            </p>
          )}
          {activeTimerEntries.map(({ key, item, rental }) => {
            const remainingSeconds = itemSecondsLeft(rental, item, now);
            const totalSeconds = item.durationMinutes * 60;
            const timerTone = getTimerTone(remainingSeconds);
            const progress =
              totalSeconds > 0
                ? Math.max(
                    0,
                    Math.min(100, (remainingSeconds / totalSeconds) * 100),
                  )
                : 0;
            const endTime = new Date(now + remainingSeconds * 1000);
            const formattedEndTime = endTime.toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            });

            return (
              <button
                className="rounded-xl border border-[var(--rf-blue)]/22 bg-[color:color-mix(in_srgb,var(--rf-yellow)_22%,white)] p-3 text-left transition hover:border-[var(--rf-blue)]/42"
                key={key}
                onClick={() => setSelectedTimerId(rental.id)}
                type="button"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <b className="block">{item.floatName}</b>
                    <span className="block text-xs text-[var(--rf-ink)]/72">
                      {rental.id} · {formatRentalDuration(item.durationMinutes)}
                    </span>
                    <span className="mt-1 text-xs text-[var(--rf-ink)]/72">
                      Ends at {formattedEndTime}
                    </span>
                  </div>
                  <CountdownDisplay
                    label={timerTone.title}
                    labelClassName={timerTone.labelClass}
                    valueClassName={timerTone.chipClass}
                    totalSeconds={remainingSeconds}
                  />
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/80">
                  <div
                    className={`h-full rounded-full transition-all ${timerTone.progressClass}`}
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </button>
            );
          })}
        </div>
      </section>
      {selectedTimerRental && (
        <ActiveTimerModal
          now={now}
          onClose={() => setSelectedTimerId(null)}
          onReturn={returnRental}
          onReturnItem={returnRentalItem}
          rental={selectedTimerRental}
        />
      )}
    </section>
  );
}


function CountdownDisplay({
  label,
  labelClassName,
  totalSeconds,
  valueClassName,
}: {
  label: string;
  labelClassName: string;
  totalSeconds: number;
  valueClassName: string;
}) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const segments =
    hours > 0
      ? [
          ["hrs", hours],
          ["min", minutes],
          ["sec", seconds],
        ]
      : [
          ["min", minutes],
          ["sec", seconds],
        ];

  return (
    <div className="text-right">
      <span
        className={`block text-[10px] font-bold uppercase tracking-wide ${labelClassName}`}
      >
        {label}
      </span>
      <div className="mt-1 flex items-start justify-end gap-1">
        {segments.map(([label, value]) => (
          <div className="flex items-start gap-1" key={label}>
            <span
              className={`grid min-w-10 rounded-md px-2 py-1 text-center ${valueClassName}`}
            >
              <b className="font-mono text-base leading-4">
                {String(value).padStart(2, "0")}
              </b>
              <span
                className={`text-[9px] font-bold uppercase leading-3 ${labelClassName}`}
              >
                {label}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActiveTimerModal({
  now,
  onClose,
  onReturn,
  onReturnItem,
  rental,
}: {
  now: number;
  onClose: () => void;
  onReturn: (rentalId: string) => void;
  onReturnItem: (
    rentalId: string,
    itemId: string | undefined,
    itemIndex: number,
  ) => void;
  rental: RentalRecord;
}) {
  const remainingSeconds = secondsLeft(rental, now);
  const totalSeconds = rental.durationMinutes * 60;
  const timerTone = getTimerTone(remainingSeconds);
  const progress =
    totalSeconds > 0
      ? Math.max(0, Math.min(100, (remainingSeconds / totalSeconds) * 100))
      : 0;

  return (
    <div
      aria-labelledby="active-timer-title"
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-end bg-[var(--rf-ink)]/45 p-0 sm:place-items-center sm:p-4"
      onClick={onClose}
      role="dialog"
    >
      <section
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-xl bg-white p-4 shadow-2xl sm:max-w-lg sm:rounded-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[var(--rf-orange-deep)]">Active rental</p>
            <h2 className="text-2xl font-bold" id="active-timer-title">
              {rental.id}
            </h2>
            <p className="text-sm text-slate-600">{getRentalTitle(rental)}</p>
          </div>
          <button
            className="rounded-md border border-slate-200 px-3 py-2 text-sm font-bold"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>

        <div className="mt-4 rounded-md bg-slate-50 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Next item due
              </span>
              <p className="mt-1 text-sm text-slate-600">
                {formatRentalDurationSummary(rental)}
              </p>
            </div>
            <CountdownDisplay
              label={timerTone.title}
              labelClassName={timerTone.labelClass}
              totalSeconds={remainingSeconds}
              valueClassName={timerTone.chipClass}
            />
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200">
            <div
              className={`h-full rounded-full transition-all ${timerTone.progressClass}`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <dl className="mt-4 divide-y divide-slate-200 rounded-md border border-slate-200 bg-white px-4 text-sm">
          <DetailItem label="Customer" value={rental.customerName} />
          <DetailItem label="Cottage" value={rental.cottageNumber} />
          <DetailItem label="Mobile" value={rental.mobile} />
          <DetailItem label="Payment" value={formatPaymentMode(rental)} />
          <DetailItem
            label="Amount"
            value={formatAmountDue(rental.amountDue)}
          />
          <DetailItem
            label="Durations"
            value={formatRentalDurationSummary(rental)}
          />
          <DetailItem
            label="Activated"
            value={formatTime(rental.activatedAt)}
          />
          <DetailItem label="Created" value={formatTime(rental.createdAt)} />
          <DetailItem
            label="SMS reminder"
            value={
              rental.smsSentAt
                ? `Sent ${formatTime(rental.smsSentAt)}`
                : "Waiting for 15-minute mark"
            }
          />
        </dl>

        <div className="mt-4 rounded-md border border-slate-200 p-3">
          <h3 className="text-sm font-bold">Rented items</h3>
          <div className="mt-3 space-y-2">
            {getRentalItems(rental).map((item, index) => {
              const itemRemainingSeconds = itemSecondsLeft(rental, item, now);
              const itemTimerTone = getTimerTone(itemRemainingSeconds);
              const itemTotalSeconds = item.durationMinutes * 60;
              const itemProgress =
                itemTotalSeconds > 0
                  ? Math.max(
                      0,
                      Math.min(
                        100,
                        (itemRemainingSeconds / itemTotalSeconds) * 100,
                      ),
                    )
                  : 0;

              return (
                <div
                  className="rounded-md bg-slate-50 p-3 text-sm"
                  key={item.id ?? `${item.floatId}-${index}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <b>{item.floatName}</b>
                      <p className="text-slate-600">
                        {formatRentalDuration(item.durationMinutes)} ·{" "}
                        {formatAmountDue(item.subtotal)}
                      </p>
                      {isRentalItemReturned(item) && (
                        <p className="mt-1 text-xs font-semibold text-[var(--rf-blue-deep)]">
                          Returned {formatTime(item.returnedAt)}
                        </p>
                      )}
                    </div>
                    <CountdownDisplay
                      label={itemTimerTone.title}
                      labelClassName={itemTimerTone.labelClass}
                      totalSeconds={itemRemainingSeconds}
                      valueClassName={itemTimerTone.chipClass}
                    />
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className={`h-full rounded-full transition-all ${itemTimerTone.progressClass}`}
                      style={{ width: `${itemProgress}%` }}
                    />
                  </div>
                  {!isRentalItemReturned(item) && (
                    <button
                      className="mt-3 h-10 w-full rounded-md border border-[color:color-mix(in_srgb,var(--rf-blue)_40%,white)] bg-white text-sm font-bold text-[var(--rf-ink)]"
                      onClick={() => onReturnItem(rental.id, item.id, index)}
                      type="button"
                    >
                      Return this item
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-4">
          <button
            className="h-11 w-full rounded-md bg-[var(--rf-orange)] text-sm font-bold text-white transition hover:bg-[var(--rf-orange-deep)]"
            onClick={() => onReturn(rental.id)}
            type="button"
          >
            Return all items
          </button>
        </div>
      </section>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <dt className="shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="text-right font-semibold text-[var(--rf-ink)]">{value}</dd>
    </div>
  );
}

function formatPaymentMode(rental: RentalRecord) {
  return rental.paymentMode === "Free" ? "Free rental" : rental.paymentMode;
}
