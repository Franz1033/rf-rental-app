"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function AdminAuthForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!password.trim()) {
      setMessage("Enter the admin password.");
      return;
    }

    setIsSubmitting(true);
    setMessage("");

    const response = await fetch("/api/admin/login", {
      body: JSON.stringify({ password }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    const body = (await response.json().catch(() => ({}))) as {
      message?: string;
    };

    setIsSubmitting(false);

    if (!response.ok) {
      setMessage(body.message ?? "Unable to sign in.");
      return;
    }

    setPassword("");
    router.refresh();
  };

  return (
    <section className="mx-auto w-full max-w-md rounded-xl bg-white p-6 shadow-sm">
      <div>
        <h1 className="text-2xl font-bold text-slate-950">Admin access</h1>
        <p className="mt-2 text-sm text-slate-600">
          Enter the admin password to open the dashboard.
        </p>
      </div>

      <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
        <label className="block text-sm font-semibold text-slate-700">
          Password
          <input
            autoComplete="current-password"
            className="mt-2 h-12 w-full rounded-md border border-slate-300 px-3 text-base outline-none focus:border-teal-600"
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            value={password}
          />
        </label>

        {message && <p className="text-sm font-semibold text-rose-700">{message}</p>}

        <button
          className="h-12 w-full rounded-md bg-slate-950 px-4 font-bold text-white disabled:bg-slate-300"
          disabled={isSubmitting}
          type="submit"
        >
          {isSubmitting ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </section>
  );
}
