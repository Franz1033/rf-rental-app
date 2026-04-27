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
      <main className="min-h-screen bg-[#f7f4ec] px-4 py-10 text-slate-950 sm:px-6">
        <AdminAuthForm />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f7f4ec] text-slate-950">
      <section className="flex w-full flex-col py-0">
        <AdminSidebar />
        <div className="mx-auto min-w-0 w-full max-w-7xl px-4 pt-4 pb-6 sm:px-6 sm:pt-6 sm:pb-8">
          {children}
        </div>
      </section>
    </main>
  );
}
