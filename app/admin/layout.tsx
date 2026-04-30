import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { AdminAuthForm } from "./admin-auth-form";
import { AdminSidebar } from "./admin-sidebar";
import { isAuthenticatedAdmin } from "@/app/lib/admin-auth";

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const cookieStore = await cookies();
  const isAuthenticated = isAuthenticatedAdmin(
    cookieStore.get("rf_admin_session")?.value,
  );

  if (!isAuthenticated) {
    return (
      <main className="min-h-screen bg-[#f5f5f5] px-4 py-10 text-[var(--rf-ink)] sm:px-6">
        <AdminAuthForm />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f5f5f5] text-[var(--rf-ink)]">
      <section className="flex w-full flex-col py-0 lg:flex-row lg:items-stretch">
        <AdminSidebar />
        <div className="min-w-0 flex-1">
          <div className="mx-auto w-full max-w-7xl px-4 pt-4 pb-6 sm:px-6 sm:pt-5 sm:pb-8 lg:px-8 lg:pt-8 lg:pb-10">
          {children}
          </div>
        </div>
      </section>
    </main>
  );
}
