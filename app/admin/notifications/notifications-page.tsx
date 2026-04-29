"use client";

import { FormEvent, useEffect, useState } from "react";
import { isValidPhilippineMobile } from "@/app/rental-data";

export default function NotificationsPage() {
  const [notificationMobile, setNotificationMobile] = useState("");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const response = await fetch("/api/admin/settings", {
          cache: "no-store",
        });
        const body = (await response.json().catch(() => ({}))) as {
          message?: string;
          notificationMobile?: string;
        };

        if (!response.ok) {
          throw new Error(body.message ?? "Unable to load notification settings.");
        }

        setNotificationMobile(body.notificationMobile ?? "");
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Unable to load notification settings.",
        );
      } finally {
        setIsLoading(false);
      }
    };

    void loadSettings();
  }, []);

  const saveNotificationMobile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage("");

    if (notificationMobile && !isValidPhilippineMobile(notificationMobile)) {
      setMessage("Enter a valid PH mobile number, e.g. 0917 123 4567.");
      return;
    }

    setIsSaving(true);

    try {
      const response = await fetch("/api/admin/settings", {
        body: JSON.stringify({ notificationMobile }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "PATCH",
      });
      const body = (await response.json().catch(() => ({}))) as {
        message?: string;
        notificationMobile?: string;
      };

      if (!response.ok) {
        throw new Error(body.message ?? "Unable to save notification settings.");
      }

      setNotificationMobile(body.notificationMobile ?? "");
      setMessage(
        body.notificationMobile
          ? `Notifications will be sent to ${body.notificationMobile}.`
          : "Admin notification mobile was cleared.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to save notification settings.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="space-y-5">
      <header className="space-y-3 py-2">
        <div>
          <h1 className="text-3xl font-bold tracking-normal text-slate-950 sm:text-4xl">
            Notifications
          </h1>
          <p className="mt-2 max-w-2xl text-base leading-7 text-slate-700">
            Customer SMS still goes to the customer's number. This setting is
            for the separate admin alert that is sent when a rental is already
            due for pickup.
          </p>
        </div>
      </header>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <form className="space-y-4" onSubmit={saveNotificationMobile}>
          <label className="block text-sm font-semibold text-slate-800">
            Admin notification mobile
            <input
              className="mt-2 h-12 w-full rounded-md border border-slate-300 px-3 text-base outline-none focus:border-teal-600"
              disabled={isLoading || isSaving}
              inputMode="tel"
              onChange={(event) => setNotificationMobile(event.target.value)}
              placeholder="09XX XXX XXXX"
              value={notificationMobile}
            />
          </label>

          {message && <p className="text-sm text-slate-600">{message}</p>}

          <button
            className="h-11 rounded-md bg-slate-950 px-4 text-sm font-bold text-white disabled:bg-slate-300"
            disabled={isLoading || isSaving}
            type="submit"
          >
            {isSaving ? "Saving..." : "Save mobile"}
          </button>
        </form>
      </section>
    </section>
  );
}
