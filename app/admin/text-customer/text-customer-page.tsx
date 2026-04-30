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

type AdminTextMessageHistory = {
  createdAt: number;
  customerName: string;
  id: string;
  message: string;
  mobile: string;
  rentalId: string | null;
};

export default function TextCustomerPage() {
  const [rentals] = useRentals();
  const [selectedRentalId, setSelectedRentalId] = useState("");
  const [template, setTemplate] = useState<TemplateKey>("return-now");
  const [mobileDraft, setMobileDraft] = useState("");
  const [messageDraft, setMessageDraft] = useState("");
  const [hasEditedMobile, setHasEditedMobile] = useState(false);
  const [hasEditedMessage, setHasEditedMessage] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [history, setHistory] = useState<AdminTextMessageHistory[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);

  const messageableRentals = rentals
    .filter((rental) => rental.mobile.trim())
    .slice()
    .sort(compareRentalsByNewest);

  const activeRentalId = selectedRentalId || messageableRentals[0]?.id || "";
  const selectedRental =
    messageableRentals.find((rental) => rental.id === activeRentalId) ?? null;
  const mobile = hasEditedMobile ? mobileDraft : selectedRental?.mobile ?? "";
  const message = hasEditedMessage
    ? messageDraft
    : selectedRental
      ? buildTemplateMessage(template, selectedRental)
      : "";

  useEffect(() => {
    const loadHistory = async () => {
      try {
        const response = await fetch("/api/admin/text-customer", {
          cache: "no-store",
        });
        const body = (await response.json().catch(() => ({}))) as {
          message?: string;
          messages?: AdminTextMessageHistory[];
        };

        if (!response.ok) {
          throw new Error(body.message ?? "Unable to load text history.");
        }

        setHistory(body.messages ?? []);
      } catch (error) {
        setFeedback(
          error instanceof Error
            ? error.message
            : "Unable to load text history.",
        );
      } finally {
        setIsLoadingHistory(false);
      }
    };

    void loadHistory();
  }, []);

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
          customerName: selectedRental?.customerName ?? "",
          message: message.trim(),
          mobile,
          rentalId: selectedRental?.id ?? "",
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const body = (await response.json().catch(() => ({}))) as {
        messageLog?: AdminTextMessageHistory;
        message?: string;
      };

      if (!response.ok) {
        throw new Error(body.message ?? "Unable to send customer SMS.");
      }

      setFeedback("Customer SMS sent.");
      if (body.messageLog) {
        setHistory((current) => [body.messageLog!, ...current].slice(0, 30));
      }
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
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--rf-ink)]">
          Text Customer
        </h1>
        <p className="max-w-3xl text-sm leading-6 text-slate-600">
          Send a manual SMS to a customer. Pick one of the recent rentals,
          choose a ready-made message, then edit it however you need before
          sending.
        </p>
      </header>

      {messageableRentals.length === 0 ? (
        <p className="rounded-sm border border-[#ececec] bg-white p-4 text-sm text-slate-600 shadow-sm">
          Rentals with customer mobile numbers will appear here once checkout is
          completed.
        </p>
      ) : (
        <>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)]">
            <section className="rounded-sm border border-[#ececec] bg-white p-4 shadow-sm">
            <label className="block text-sm font-semibold text-[var(--rf-ink)]">
              Customer rental
              <select
                className="mt-2 h-12 w-full rounded-sm border border-[#dddddd] bg-white px-3 text-sm outline-none focus:border-[#1f7a36]"
                onChange={(event) => {
                  setSelectedRentalId(event.target.value);
                  setHasEditedMobile(false);
                  setHasEditedMessage(false);
                  setMobileDraft("");
                  setMessageDraft("");
                }}
                value={activeRentalId}
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
              <div className="mt-4 rounded-sm bg-[#fafafa] p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Items
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-700">
                  {summarizeItems(selectedRental)}
                </p>
              </div>
            )}
            </section>

            <section className="rounded-sm border border-[#ececec] bg-white p-4 shadow-sm">
              <form className="space-y-4" onSubmit={handleSubmit}>
              <label className="block text-sm font-semibold text-[var(--rf-ink)]">
                Message type
                <select
                  className="mt-2 h-12 w-full rounded-sm border border-[#dddddd] bg-white px-3 text-sm outline-none focus:border-[#1f7a36]"
                  onChange={(event) => {
                    setTemplate(event.target.value as TemplateKey);
                    setHasEditedMessage(false);
                    setMessageDraft("");
                  }}
                  value={template}
                >
                  {templateOptions.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-sm font-semibold text-[var(--rf-ink)]">
                Customer mobile
                <input
                  className="mt-2 h-12 w-full rounded-sm border border-[#dddddd] px-3 text-base outline-none focus:border-[#1f7a36]"
                  disabled={isSending}
                  inputMode="tel"
                  onChange={(event) => {
                    setHasEditedMobile(true);
                    setMobileDraft(event.target.value);
                  }}
                  placeholder="09XX XXX XXXX"
                  value={mobile}
                />
              </label>

              <label className="block text-sm font-semibold text-[var(--rf-ink)]">
                Message
                <textarea
                  className="mt-2 min-h-44 w-full rounded-sm border border-[#dddddd] px-3 py-3 text-sm leading-6 outline-none focus:border-[#1f7a36]"
                  disabled={isSending}
                  onChange={(event) => {
                    setHasEditedMessage(true);
                    setMessageDraft(event.target.value);
                  }}
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
                className="h-11 rounded-sm bg-[#1f7a36] px-4 text-sm font-bold text-white transition hover:bg-[#17642b] disabled:bg-[#9fbea8]"
                disabled={isSending || !selectedRental}
                type="submit"
              >
                {isSending ? "Sending..." : "Send SMS"}
              </button>
              </form>
            </section>
          </div>

          <section className="rounded-sm border border-[#ececec] bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-[var(--rf-ink)]">
                  Sent message history
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Only messages sent from this admin text tool appear here.
                </p>
              </div>
            </div>

            {isLoadingHistory ? (
              <p className="mt-4 text-sm text-slate-500">Loading history...</p>
            ) : history.length === 0 ? (
              <p className="mt-4 rounded-sm bg-[#fafafa] p-3 text-sm text-slate-600">
                No successfully sent admin text messages yet.
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                {history.map((entry) => (
                  <article
                    className="rounded-sm border border-[#efefef] bg-[#fafafa] p-3"
                    key={entry.id}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-[var(--rf-ink)]">
                          {entry.customerName || "Customer"}{" "}
                          <span className="font-normal text-slate-500">
                            {entry.mobile}
                          </span>
                        </p>
                        {entry.rentalId && (
                          <p className="mt-1 text-xs text-slate-500">
                            Rental ID: {entry.rentalId}
                          </p>
                        )}
                      </div>
                      <p className="text-xs text-slate-500">
                        {formatTime(entry.createdAt)}
                      </p>
                    </div>
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                      {entry.message}
                    </p>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm border border-[#efefef] bg-[#fafafa] px-3 py-2">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 font-semibold text-[var(--rf-ink)]">{value || "Not set"}</dd>
    </div>
  );
}
