import { createHash, randomInt } from "node:crypto";
import {
  getSemaphoreConfig,
  isSemaphoreSenderNameError,
  maskMobileForLogs,
  normalizeSemaphoreMobile,
} from "@/app/lib/sms";

const verificationCookieName = "rf_sms_verification";
const verificationLifetimeMs = 10 * 60 * 1000;

type VerificationPayload = {
  codeHash: string;
  expiresAt: number;
  mobile: string;
};

function getVerificationSecret() {
  return process.env.SMS_VERIFICATION_SECRET ?? "";
}

function hashVerificationCode(
  mobile: string,
  code: string,
  expiresAt: number,
  secret: string,
) {
  return createHash("sha256")
    .update(`${secret}:${mobile}:${code}:${expiresAt}`)
    .digest("hex");
}

export function buildVerificationCookie(mobile: string, code: string) {
  const secret = getVerificationSecret();

  if (!secret) {
    throw new Error("Missing SMS_VERIFICATION_SECRET.");
  }

  const expiresAt = Date.now() + verificationLifetimeMs;
  const payload: VerificationPayload = {
    codeHash: hashVerificationCode(mobile, code, expiresAt, secret),
    expiresAt,
    mobile,
  };

  return {
    expiresAt,
    name: verificationCookieName,
    value: Buffer.from(JSON.stringify(payload)).toString("base64url"),
  };
}

export function clearVerificationCookie() {
  return {
    maxAge: 0,
    name: verificationCookieName,
    value: "",
  };
}

export function generateVerificationCode() {
  return String(randomInt(100000, 1000000));
}

export function readVerificationCookie(
  cookieValue: string | undefined,
): VerificationPayload | null {
  if (!cookieValue) {
    return null;
  }

  try {
    const decoded = Buffer.from(cookieValue, "base64url").toString("utf8");
    return JSON.parse(decoded) as VerificationPayload;
  } catch {
    return null;
  }
}

export function verifySubmittedCode(
  payload: VerificationPayload | null,
  mobile: string,
  code: string,
) {
  const secret = getVerificationSecret();

  if (!secret || !payload) {
    return false;
  }

  if (payload.mobile !== mobile || payload.expiresAt < Date.now()) {
    return false;
  }

  return (
    payload.codeHash ===
    hashVerificationCode(mobile, code, payload.expiresAt, secret)
  );
}

export async function sendVerificationSms(mobile: string, code: string) {
  const { apiKey, senderName } = getSemaphoreConfig();

  if (!apiKey) {
    throw new Error(
      "Missing Semaphore SMS configuration. Set SEMAPHORE_API_KEY.",
    );
  }

  const sendRequest = async (includeSenderName: boolean) => {
    const normalizedMobile = normalizeSemaphoreMobile(mobile);
    const payload = new URLSearchParams({
      apikey: apiKey,
      code,
      message:
        "Your Royal Farm verification code is {otp}. It expires in 10 minutes. Do not share this code.",
      number: normalizedMobile,
    });

    if (includeSenderName && senderName) {
      payload.set("sendername", senderName);
    }

    console.info("[sms] Sending verification code", {
      codeLength: code.length,
      hasSenderName: includeSenderName && Boolean(senderName),
      mobile: maskMobileForLogs(normalizedMobile),
    });

    const response = await fetch("https://api.semaphore.co/api/v4/otp", {
      body: payload,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      method: "POST",
    });
    const rawBody = await response.text();
    let parsedBody: unknown = null;

    try {
      parsedBody = rawBody ? (JSON.parse(rawBody) as unknown) : null;
    } catch {
      parsedBody = null;
    }

    const failedMessage = Array.isArray(parsedBody)
      ? (parsedBody.find((entry) => {
          if (!entry || typeof entry !== "object" || !("status" in entry)) {
            return false;
          }

          const status = String(entry.status).toLowerCase();
          return status === "failed" || status === "refunded";
        }) as
          | {
              message?: string;
              status?: string;
            }
          | undefined)
      : undefined;

    const responseBody = (parsedBody ?? {}) as { message?: string };
    const errorMessage =
      failedMessage?.message ??
      responseBody.message ??
      rawBody ??
      (failedMessage
        ? `Semaphore rejected the verification SMS with status ${failedMessage.status ?? "failed"}.`
        : "Unable to send verification SMS.");

    if (!response.ok || failedMessage) {
      console.error("[sms] Verification send failed", {
        errorMessage,
        hasSenderName: includeSenderName && Boolean(senderName),
        mobile: maskMobileForLogs(normalizedMobile),
        status: response.status,
      });
      throw new Error(errorMessage);
    }

    console.info("[sms] Verification code sent", {
      hasSenderName: includeSenderName && Boolean(senderName),
      mobile: maskMobileForLogs(normalizedMobile),
      status: response.status,
    });
  };

  try {
    await sendRequest(Boolean(senderName));
  } catch (error) {
    if (
      senderName &&
      error instanceof Error &&
      isSemaphoreSenderNameError(error.message)
    ) {
      console.warn("[sms] Retrying verification SMS without sender name", {
        mobile: maskMobileForLogs(mobile),
      });
      await sendRequest(false);
      return;
    }

    throw error;
  }
}
