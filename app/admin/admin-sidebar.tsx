"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const primaryLinks = [
  { href: "/admin", label: "Home" },
  { href: "/admin/active-timers", label: "Active Rentals" },
  { href: "/admin/notifications", label: "Notifications" },
  { href: "/admin/text-customer", label: "Text Customer" },
  { href: "/admin/inventory", label: "Inventory" },
  { href: "/admin/records", label: "Rental Records" },
];

export function AdminSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useEffect(() => {
    if (!isClosing) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setIsClosing(false);
      setIsOpen(false);
    }, 200);

    return () => window.clearTimeout(timeout);
  }, [isClosing]);

  const openMenu = () => {
    setIsClosing(false);
    setIsOpen(true);
  };

  const closeMenu = () => {
    setIsClosing(true);
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    await fetch("/api/admin/login", { method: "DELETE" });
    setIsLoggingOut(false);
    closeMenu();
    router.refresh();
  };

  return (
    <>
      <aside className="border-b border-slate-800 bg-slate-950 text-white lg:hidden">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <h2 className="text-lg font-bold">Royal Farm Admin</h2>
          <button
            aria-controls="admin-mobile-drawer"
            aria-expanded={isOpen}
            aria-label="Open admin menu"
            className="inline-flex size-11 items-center justify-center rounded-full border border-white/20 text-white"
            onClick={openMenu}
            type="button"
          >
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
              <path d="M4 7h16" />
              <path d="M4 12h16" />
              <path d="M4 17h16" />
            </svg>
          </button>
        </div>
      </aside>

      {isOpen && (
        <div
          className={`fixed inset-0 z-50 transition-opacity duration-200 ease-out lg:hidden ${
            isClosing ? "bg-slate-950/0" : "bg-slate-950/45"
          }`}
        >
          <div
            aria-hidden="true"
            className="absolute inset-0"
            onClick={closeMenu}
          />
          <aside
            aria-label="Admin navigation"
            className={`absolute inset-y-0 right-0 flex w-[84vw] max-w-sm flex-col bg-white shadow-2xl transition-transform duration-200 ease-out ${
              isClosing ? "translate-x-full" : "translate-x-0"
            }`}
            id="admin-mobile-drawer"
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <p className="text-lg font-bold text-slate-950">Admin Menu</p>
              </div>
              <button
                aria-label="Close admin menu"
                className="inline-flex size-10 items-center justify-center rounded-full border border-slate-200 text-slate-700"
                onClick={closeMenu}
                type="button"
              >
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
                  <path d="M6 6l12 12" />
                  <path d="M18 6L6 18" />
                </svg>
              </button>
            </div>

            <nav className="flex-1 space-y-2 px-3 py-5">
              {primaryLinks.map((link) => {
                const isActive =
                  link.href === "/admin"
                    ? pathname === link.href
                    : pathname === link.href ||
                      pathname.startsWith(`${link.href}/`);

                return (
                  <Link
                    className={`flex items-center justify-between rounded-lg px-4 py-3 text-sm font-semibold transition ${
                      isActive
                        ? "bg-slate-950 text-white shadow-sm"
                        : "text-slate-700 hover:bg-slate-100"
                    }`}
                    href={link.href}
                    key={link.href}
                    onClick={closeMenu}
                  >
                    {link.label}
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
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                  </Link>
                );
              })}
            </nav>

            <div className="border-t border-slate-200 px-5 py-4">
              <div className="flex flex-col gap-3">
                <Link
                  className="inline-flex items-center text-sm font-semibold text-slate-700"
                  href="/"
                  onClick={closeMenu}
                >
                  Open Customer Page
                </Link>
                <button
                  className="text-left text-sm font-semibold text-rose-700"
                  disabled={isLoggingOut}
                  onClick={handleLogout}
                  type="button"
                >
                  {isLoggingOut ? "Signing out..." : "Sign out"}
                </button>
              </div>
            </div>
          </aside>
        </div>
      )}

      <aside className="hidden border-b border-slate-800 bg-slate-950 text-white lg:block">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-6 px-6 py-4">
          <div className="shrink-0">
            <p className="text-lg font-bold text-white">Royal Farm Admin</p>
          </div>

          <div className="flex items-center gap-6">
            <nav aria-label="Admin navigation" className="flex items-center gap-2">
              {primaryLinks.map((link) => {
                const isActive =
                  link.href === "/admin"
                    ? pathname === link.href
                    : pathname === link.href ||
                      pathname.startsWith(`${link.href}/`);

                return (
                  <Link
                    className={`rounded-md px-4 py-2 text-sm font-semibold transition ${
                      isActive
                        ? "bg-white text-slate-950 shadow-sm"
                        : "text-white/75 hover:bg-white/10 hover:text-white"
                    }`}
                    href={link.href}
                    key={link.href}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </nav>

            <Link
              className="shrink-0 text-sm font-semibold text-white/75 hover:text-white"
              href="/"
            >
              Customer
            </Link>
            <button
              className="shrink-0 text-sm font-semibold text-rose-300 transition hover:text-rose-200"
              disabled={isLoggingOut}
              onClick={handleLogout}
              type="button"
            >
              {isLoggingOut ? "Signing out..." : "Sign out"}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
