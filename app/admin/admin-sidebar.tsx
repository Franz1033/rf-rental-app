"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const primaryLinks = [
  { href: "/admin", label: "Home", icon: "home" },
  { href: "/admin/active-rentals", label: "Active Rentals", icon: "clock" },
  { href: "/admin/notifications", label: "Notifications", icon: "bell" },
  { href: "/admin/text-customer", label: "Text Customer", icon: "message" },
  { href: "/admin/inventory", label: "Inventory", icon: "boxes" },
  { href: "/admin/records", label: "Rental Records", icon: "list" },
];

function AdminBrand() {
  return (
    <div className="flex items-center gap-2">
      <p className="text-base font-medium tracking-[0.02em] text-[#f7fff8] sm:text-lg">
        Royal Farm Rentals
      </p>
      <span className="rounded-sm border border-white/20 bg-white/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-white/90">
        Admin
      </span>
    </div>
  );
}

function NavIcon({ icon }: { icon: (typeof primaryLinks)[number]["icon"] }) {
  switch (icon) {
    case "home":
      return (
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
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5 9.5V21h14V9.5" />
        </svg>
      );
    case "clock":
      return (
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
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 3" />
        </svg>
      );
    case "bell":
      return (
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
          <path d="M15 17H5l2-2v-4a5 5 0 1 1 10 0v4l2 2h-4" />
          <path d="M9 17a3 3 0 0 0 6 0" />
        </svg>
      );
    case "message":
      return (
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
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      );
    case "boxes":
      return (
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
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          <path d="m3.3 7 8.7 5 8.7-5" />
          <path d="M12 22V12" />
        </svg>
      );
    case "list":
      return (
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
          <path d="M8 6h13" />
          <path d="M8 12h13" />
          <path d="M8 18h13" />
          <path d="M3 6h.01" />
          <path d="M3 12h.01" />
          <path d="M3 18h.01" />
        </svg>
      );
  }
}

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
      <aside className="border-b border-[#17642b] bg-[linear-gradient(180deg,#3fa55b_0%,#2f8f49_62%,#1f7a36_100%)] text-white lg:hidden">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <AdminBrand />
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
            isClosing ? "bg-[var(--rf-ink)]/0" : "bg-[var(--rf-ink)]/45"
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
                <p className="text-lg font-bold text-[var(--rf-ink)]">Admin Menu</p>
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
                        ? "bg-[#17642b] text-white shadow-sm"
                        : "text-slate-700 hover:bg-[var(--rf-cream)]"
                    }`}
                    href={link.href}
                    key={link.href}
                    onClick={closeMenu}
                  >
                    <span className="flex items-center gap-3">
                      <NavIcon icon={link.icon} />
                      <span>{link.label}</span>
                    </span>
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
                  className="text-left text-sm font-semibold text-[var(--rf-orange)]"
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

      <aside className="hidden w-72 shrink-0 border-r border-[#17642b] bg-[linear-gradient(180deg,#3fa55b_0%,#2f8f49_62%,#1f7a36_100%)] text-white lg:flex lg:min-h-screen lg:flex-col">
        <div className="sticky top-0 flex min-h-screen flex-col">
          <div className="border-b border-white/15 px-6 py-6">
            <AdminBrand />
          </div>

          <nav aria-label="Admin navigation" className="flex-1 space-y-2 px-4 py-5">
              {primaryLinks.map((link) => {
                const isActive =
                  link.href === "/admin"
                    ? pathname === link.href
                    : pathname === link.href ||
                      pathname.startsWith(`${link.href}/`);

                return (
                  <Link
                    className={`flex items-center gap-3 rounded-md px-4 py-3 text-sm font-semibold transition ${
                      isActive
                        ? "bg-[#17642b] text-white shadow-sm"
                        : "text-white/80 hover:bg-white/15 hover:text-white"
                    }`}
                    href={link.href}
                    key={link.href}
                  >
                    <NavIcon icon={link.icon} />
                    <span>{link.label}</span>
                  </Link>
                );
              })}
          </nav>

          <div className="border-t border-white/15 px-6 py-5">
            <Link
              className="block text-sm font-semibold text-white/75 transition hover:text-white"
              href="/"
            >
              Open Customer Page
            </Link>
            <button
              className="mt-3 block text-left text-sm font-semibold text-[var(--rf-cream)] transition hover:text-white"
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
