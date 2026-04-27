import { NextResponse } from "next/server";
import { maskMobileForLogs } from "@/app/lib/sms";
import {
  clearVerificationCookie,
  readVerificationCookie,
  verifySubmittedCode,
} from "@/app/lib/sms-verification";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { code?: string; mobile?: string }
    | null;
  const mobile = body?.mobile?.trim();
  const code = body?.code?.trim();

  if (!mobile || !code) {
    console.warn("[sms] Verification check missing payload", {
      hasCode: Boolean(code),
      mobile: mobile ? maskMobileForLogs(mobile) : "",
    });
    return NextResponse.json(
      { message: "Mobile number and verification code are required." },
      { status: 400 },
    );
  }

  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookieValue = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("rf_sms_verification="))
    ?.slice("rf_sms_verification=".length);
  const payload = readVerificationCookie(cookieValue);
  const verified = verifySubmittedCode(payload, mobile, code);

  if (!verified) {
    console.warn("[sms] Verification check failed", {
      hasCookie: Boolean(payload),
      mobile: maskMobileForLogs(mobile),
    });
    return NextResponse.json(
      { message: "Verification code does not match or has expired." },
      { status: 400 },
    );
  }

  console.info("[sms] Verification check passed", {
    mobile: maskMobileForLogs(mobile),
  });

  const response = NextResponse.json({ verified: true });
  const cookie = clearVerificationCookie();
  response.cookies.set(cookie.name, cookie.value, {
    httpOnly: true,
    maxAge: cookie.maxAge,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  return response;
}
