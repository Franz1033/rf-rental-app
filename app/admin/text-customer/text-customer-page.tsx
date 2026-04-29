"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  RentalRecord,
  formatTime,
  getRentalItems,
  getRentalTitle,
  isValidPhilippineMobile,
  useRentals,
} from "@/app/rental-data";

type TemplateKey =
  | "return-now"
  | "fifteen-minutes"
  | "extend-at-cashier"
  | "custom";

const templateOptions: Array<{ key: TemplateKey; label: string }> = [
  { key: "return-now", label: "Return now" },
  { key: "fifteen-minutes", label: "15-minute reminder" },
  { key: "extend-at-cashier", label: "Extend at cashier" },
  { key: "custom", label: "Custom message" },
];

function summarizeItems(rental: RentalRecord) {
  return getRentalItems(rental)
    .map((item) => `${item.floatName} (${item.durationMinutes / 60}h)`)
    .join(", ");
}

function buildTemplateMessage(template: TemplateKey, rental: RentalRecord) {
  const customerName = rental.customerName.trim() || "Customer";
  const items = summarizeItems(rental);

  switch (template) {
    case "return-now":
      return `Royal Farm: Hello ${customerName}, your rental time for ${items} is already over. Please return the item to our staff now. Thank you.`;
    case "fifteen-minutes":
      return `Royal Farm: Hello ${customerName}, this is a reminder that your rental for ${items} will end in 15 minutes. Please prepare to return the item on time.`;
    case "extend-at-cashier":
      return `Royal Farm: Hello ${customerName}, if you want to extend your rental for ${items}, please proceed to the cashier before your time ends. Thank you.`;
    case "custom":
    default:
      return "";
  }
}

function compareRentalsByNewest(first: RentalRecord, second: RentalRecord) {
  return second.createdAt - first.createdAt;
}

export default function TextCustomerPage() {
  const [rentals] = useRentals();
  const [selectedRentalId, setSelectedRentalId] = useState("");
  const [template, setTemplate] = useState<TemplateKey>("return-now");
  const [mobile, setMobile] = useState("");
  const [message, setMessage] = useState("");
  const [feedback, setFeedback] = useState("");
  const [isSending, setIsSending] = useState(false);

  const messageableRentals = rentals
    .filter((rental) => rental.mobile.trim())
    .slice()
    .sort(compareRentalsByNewest);

  const selectedRental =
    messageableRentals.find((rental) => rental.id === selectedRentalId) ?? null;

  useEffect(() => {
    if (!selectedRentalId && messageableRentals.length > 0) {
      setSelectedRentalId(messageableRentals[0].id);
    }
  }, [messageableRentals, selectedRentalId]);

  useEffect(() => {
    if (!selectedRental) {
      setMobile("");
      setMessage("");
      return;
    }

    setMobile(selectedRental.mobile);
    setMessage(buildTemplateMessage(template, selectedRental));
  }, [selectedRental, template]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFeedback("");

    if (!mobile || !isValidPhilippineMobile(mobile)) {
      setFeedback("Choose a rental with a valid customer mobile number.");
      return;
    }

    if (!message.trim()) {
      setFeedback("Enter the SMS message you want to send.");
      return;
    }

    setIsSending(true);

    try {
      const response = await fetch("/api/admin/text-customer", {
        body: JSON.stringify({
          message: message.trim(),
          mobile,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const body = (await response.json().catch(() => ({}))) as {
        message?: string;
      };

      if (!response.ok) {
        throw new Error(body.message ?? "Unable to send customer SMS.");
      }

      setFeedback("Customer SMS sent.");
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "Unable to send customer SMS.",
      );
    } finally {
      setIsSending(false);
    }
  };

  return (
    <section className="space-y-5">
      <header className="space-y-3 py-2">
        <div>
          <h1 className="text-3xl font-bold tracking-normal text-slate-950 sm:text-4xl">
            Text Customer
          </h1>
          <p className="mt-2 max-w-3xl text-base leading-7 text-slate-700">
            Send a manual SMS to a customer. Pick one of the recent rentals,
            choose a ready-made message, then edit it however you need before
            sending.
          </p>
        </div>
      </header>

      {messageableRentals.length === 0 ? (
        <p className="rounded-lg bg-white p-4 text-sm text-slate-600 shadow-sm">
          Rentals with customer mobile numbers will appear here once checkout is
          completed.
        </p>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)]">
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <label className="block text-sm font-semibold text-slate-800">
              Customer rental
              <select
                className="mt-2 h-12 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-teal-600"
                onChange={(event) => setSelectedRentalId(event.target.value)}
                value={selectedRentalId}
              >
                {messageableRentals.map((rental) => (
                  <option key={rental.id} value={rental.id}>
                    {rental.customerName} - {getRentalTitle(rental)}
                  </option>
                ))}
              </select>
            </label>

            {selectedRental && (
              <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                <InfoCard label="Customer" value={selectedRental.customerName} />
                <InfoCard label="Mobile" value={selectedRental.mobile} />
                <InfoCard label="Cottage" value={selectedRental.cottageNumber} />
                <InfoCard label="Status" value={selectedRental.status} />
                <InfoCard
                  label="Created"
                  value={formatTime(selectedRental.createdAt)}
                />
                <InfoCard
                  label="Rental"
                  value={getRentalTitle(selectedRental)}
                />
              </dl>
            )}

            {selectedRental && (
              <div className="mt-4 rounded-md bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Items
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-700">
                  {summarizeItems(selectedRental)}
                </p>
              </div>
            )}
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <form className="space-y-4" onSubmit={handleSubmit}>
              <label className="block text-sm font-semibold text-slate-800">
                Message type
                <select
                  className="mt-2 h-12 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-teal-600"
                  onChange={(event) =>
                    setTemplate(event.target.value as TemplateKey)
                  }
                  value={template}
                >
                  {templateOptions.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-sm font-semibold text-slate-800">
                Customer mobile
                <input
                  className="mt-2 h-12 w-full rounded-md border border-slate-300 px-3 text-base outline-none focus:border-teal-600"
                  disabled={isSending}
                  inputMode="tel"
                  onChange={(event) => setMobile(event.target.value)}
                  placeholder="09XX XXX XXXX"
                  value={mobile}
                />
              </label>

              <label className="block text-sm font-semibold text-slate-800">
                Message
                <textarea
                  className="mt-2 min-h-44 w-full rounded-md border border-slate-300 px-3 py-3 text-sm leading-6 outline-none focus:border-teal-600"
                  disabled={isSending}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="Type the SMS message here."
                  value={message}
                />
              </label>

              <p className="text-xs leading-5 text-slate-500">
                You can pick a ready-made message and still edit the text before
                sending.
              </p>

              {feedback && <p className="text-sm text-slate-600">{feedback}</p>}

              <button
                className="h-11 rounded-md bg-slate-950 px-4 text-sm font-bold text-white disabled:bg-slate-300"
                disabled={isSending || !selectedRental}
                type="submit"
              >
                {isSending ? "Sending..." : "Send SMS"}
              </button>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 font-semibold text-slate-950">{value || "Not set"}</dd>
    </div>
  );
}
