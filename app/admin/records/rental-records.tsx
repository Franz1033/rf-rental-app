"use client";

import { useState } from "react";
import {
  RentalRecord,
  RentalStatus,
  StatusBadge,
  formatAmountDue,
  formatRentalDuration,
  formatTime,
  getRentalItems,
  getRentalTitle,
  useRentals,
} from "@/app/rental-data";

export default function AdminRentalRecords() {
  const [rentals] = useRentals();
  const [statusFilter, setStatusFilter] = useState<"all" | RentalStatus>("all");
  const [expandedRentalId, setExpandedRentalId] = useState<string | null>(null);

  const filteredRentals = rentals.filter((rental) => {
    const matchesStatus =
      statusFilter === "all" || rental.status === statusFilter;

    return matchesStatus;
  });

  return (
    <section className="space-y-5">
      <header className="space-y-3 rounded-md bg-[linear-gradient(180deg,#ff7a45_0%,#ee4d2d_68%,#e64322_100%)] px-5 py-5 text-white">
        <div>
          <h1 className="text-3xl font-bold tracking-normal text-white sm:text-4xl">
            Rental records
          </h1>
          <p className="mt-2 max-w-2xl text-base leading-7 text-[#ffe7d6]">
            Review customer, payment, activation, return, and SMS reminder
            details.
          </p>
        </div>
      </header>

      {rentals.length === 0 ? (
        <p className="rounded-sm border border-[#ececec] bg-white p-4 text-sm text-slate-600 shadow-sm">
          Completed customer checkouts will appear here with customer, payment,
          activation, return, and SMS reminder details.
        </p>
      ) : (
        <div className="space-y-3">
          <select
            aria-label="Filter rental records by status"
            className="h-11 w-full rounded-sm border border-[#dddddd] bg-white px-3 text-sm font-semibold outline-none focus:border-[#ee4d2d]"
            onChange={(event) =>
              setStatusFilter(event.target.value as "all" | RentalStatus)
            }
            value={statusFilter}
          >
            <option value="all">All records</option>
            <option value="pending">Pending</option>
            <option value="active">Active</option>
            <option value="returned">Returned</option>
            <option value="cancelled">Cancelled</option>
            <option value="expired">Expired</option>
          </select>
          <p className="text-sm text-slate-500">
            Showing {filteredRentals.length} of {rentals.length} record
            {rentals.length === 1 ? "" : "s"}.
          </p>
        </div>
      )}

      {rentals.length > 0 && filteredRentals.length === 0 ? (
        <p className="rounded-sm border border-[#ececec] bg-white p-4 text-sm text-slate-600 shadow-sm">
          No rental records match the current filters.
        </p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {filteredRentals.map((rental) => (
            <RentalRecordCard
              expanded={expandedRentalId === rental.id}
              key={rental.id}
              onToggle={() =>
                setExpandedRentalId((current) =>
                  current === rental.id ? null : rental.id,
                )
              }
              rental={rental}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function formatPaymentMode(rental: RentalRecord) {
  return rental.paymentMode === "Free" ? "Free rental" : rental.paymentMode;
}

function RentalRecordCard({
  expanded,
  onToggle,
  rental,
}: {
  expanded: boolean;
  onToggle: () => void;
  rental: RentalRecord;
}) {
  return (
    <article className="rounded-sm border border-[#ececec] bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <b className="block">{rental.id}</b>
          <p className="text-sm text-[#666]">{getRentalTitle(rental)}</p>
        </div>
        <StatusBadge status={rental.status} />
      </div>

      <dl className="mt-4 space-y-3 text-sm">
        <RecordRow label="Customer" value={rental.customerName} />
        <RecordRow label="Amount" value={formatAmountDue(rental.amountDue)} />
        <RecordRow
          label="Duration"
          value={formatRentalDuration(rental.durationMinutes)}
        />
      </dl>

      <button
        className="mt-4 text-sm font-semibold text-[var(--rf-ink)] underline-offset-4 transition hover:text-[var(--rf-orange-deep)] hover:underline"
        onClick={onToggle}
        type="button"
      >
        {expanded ? "Hide details" : "View details"}
      </button>

      {expanded && (
        <>
          <dl className="mt-4 grid gap-2 sm:grid-cols-2">
            <DetailCard label="Mobile" value={rental.mobile} />
            <DetailCard label="Cottage" value={rental.cottageNumber} />
            <DetailCard label="Payment" value={formatPaymentMode(rental)} />
            <DetailCard label="Activated" value={formatTime(rental.activatedAt)} />
            <DetailCard label="Returned" value={formatTime(rental.returnedAt)} />
            <DetailCard
              label={rental.status === "expired" ? "Expired" : "Cancelled"}
              value={formatTime(rental.cancelledAt)}
            />
          </dl>

          <div className="mt-4 rounded-sm bg-[#fafafa] p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Items
            </p>
            <div className="mt-2 space-y-2">
              {getRentalItems(rental).map((item) => (
                <div
                  className="rounded-sm border border-[#efefef] bg-white px-3 py-2 text-sm"
                  key={item.id ?? `${item.floatId}-${item.durationMinutes}`}
                >
                  <b className="block">{item.floatName}</b>
                  <span className="block text-slate-600">x{item.quantity}</span>
                  {item.returnedAt && (
                      <span className="mt-1 block text-xs font-semibold text-[var(--rf-blue-deep)]">
                      Returned {formatTime(item.returnedAt)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </article>
  );
}

function RecordRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd className="text-right font-semibold text-[var(--rf-ink)]">{value}</dd>
    </div>
  );
}

function DetailCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm border border-[#efefef] bg-[#fafafa] px-3 py-2">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 font-semibold text-[var(--rf-ink)]">{value}</dd>
    </div>
  );
}
