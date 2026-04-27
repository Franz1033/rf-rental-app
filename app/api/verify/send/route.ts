import { NextResponse } from "next/server";
import { maskMobileForLogs } from "@/app/lib/sms";
import {
  buildVerificationCookie,
  clearVerificationCookie,
  generateVerificationCode,
  sendVerificationSms,
} from "@/app/lib/sms-verification";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { mobile?: string }
    | null;
  const mobile = body?.mobile?.trim();

  if (!mobile) {
    console.warn("[sms] Verification request missing mobile");
    return NextResponse.json(
      { message: "Mobile number is required." },
      { status: 400 },
    );
  }

  try {
    console.info("[sms] Verification request received", {
      mobile: maskMobileForLogs(mobile),
    });
    const code = generateVerificationCode();
    const cookie = buildVerificationCookie(mobile, code);

    await sendVerificationSms(mobile, code);

    const response = NextResponse.json({
      message: `Verification code sent to ${mobile}.`,
    });

    response.cookies.set(cookie.name, cookie.value, {
      expires: new Date(cookie.expiresAt),
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });

    return response;
  } catch (error) {
    console.error("[sms] Verification request failed", {
      error: error instanceof Error ? error.message : "Unknown error",
      mobile: maskMobileForLogs(mobile),
    });
    const response = NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Unable to send verification code.",
      },
      { status: 500 },
    );

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
}
