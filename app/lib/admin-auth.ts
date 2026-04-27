import { createHmac, timingSafeEqual } from "node:crypto";

const adminSessionCookieName = "rf_admin_session";

function getAdminPassword() {
  return process.env.ADMIN_PASSWORD ?? "";
}

function getAdminSecret() {
  return process.env.ADMIN_AUTH_SECRET ?? "";
}

function signSession(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("hex");
}

export function createAdminSessionCookie() {
  const secret = getAdminSecret();

  if (!secret) {
    throw new Error("Missing ADMIN_AUTH_SECRET.");
  }

  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const payload = `admin:${expiresAt}`;
  const signature = signSession(payload, secret);

  return {
    expiresAt,
    name: adminSessionCookieName,
    value: `${payload}.${signature}`,
  };
}

export function clearAdminSessionCookie() {
  return {
    maxAge: 0,
    name: adminSessionCookieName,
    value: "",
  };
}

export function isValidAdminPassword(password: string) {
  const adminPassword = getAdminPassword();

  if (!adminPassword) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(password),
    Buffer.from(adminPassword),
  );
}

export function isAuthenticatedAdmin(cookieValue: string | undefined) {
  const secret = getAdminSecret();

  if (!secret || !cookieValue) {
    return false;
  }

  const separatorIndex = cookieValue.lastIndexOf(".");

  if (separatorIndex === -1) {
    return false;
  }

  const payload = cookieValue.slice(0, separatorIndex);
  const signature = cookieValue.slice(separatorIndex + 1);
  const expectedSignature = signSession(payload, secret);

  if (
    signature.length !== expectedSignature.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
  ) {
    return false;
  }

  const [role, expiresAtRaw] = payload.split(":");
  const expiresAt = Number(expiresAtRaw);

  return role === "admin" && Number.isFinite(expiresAt) && expiresAt > Date.now();
}
