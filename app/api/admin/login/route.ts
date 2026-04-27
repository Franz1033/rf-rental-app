import { NextResponse } from "next/server";
import {
  clearAdminSessionCookie,
  createAdminSessionCookie,
  isValidAdminPassword,
} from "@/app/lib/admin-auth";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { password?: string }
    | null;
  const password = body?.password?.trim() ?? "";

  if (!password) {
    return NextResponse.json(
      { message: "Admin password is required." },
      { status: 400 },
    );
  }

  if (!isValidAdminPassword(password)) {
    return NextResponse.json(
      { message: "Incorrect admin password." },
      { status: 401 },
    );
  }

  const cookie = createAdminSessionCookie();
  const response = NextResponse.json({ authenticated: true });
  response.cookies.set(cookie.name, cookie.value, {
    expires: new Date(cookie.expiresAt),
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ authenticated: false });
  const cookie = clearAdminSessionCookie();

  response.cookies.set(cookie.name, cookie.value, {
    httpOnly: true,
    maxAge: cookie.maxAge,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  return response;
}
