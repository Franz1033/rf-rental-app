export function getSemaphoreConfig() {
  const senderName = process.env.SEMAPHORE_SENDERNAME?.trim();

  return {
    apiKey: process.env.SEMAPHORE_API_KEY,
    senderName: senderName ? senderName : undefined,
  };
}

export function normalizeSemaphoreMobile(mobile: string) {
  const digits = mobile.replace(/\D/g, "");

  if (digits.startsWith("09") && digits.length === 11) {
    return `63${digits.slice(1)}`;
  }

  if (digits.startsWith("639") && digits.length === 12) {
    return digits;
  }

  return digits;
}

export function isSemaphoreSenderNameError(message: string) {
  return /sender\s*name/i.test(message);
}

export function maskMobileForLogs(mobile: string) {
  const digits = mobile.replace(/\D/g, "");

  if (digits.length <= 4) {
    return digits;
  }

  return `${digits.slice(0, 2)}***${digits.slice(-2)}`;
}

export async function sendSmsMessage(mobile: string, message: string) {
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
      message,
      number: normalizedMobile,
    });

    if (includeSenderName && senderName) {
      payload.set("sendername", senderName);
    }

    console.info("[sms] Sending rental notification", {
      hasSenderName: includeSenderName && Boolean(senderName),
      messageLength: message.length,
      mobile: maskMobileForLogs(normalizedMobile),
    });

    const response = await fetch("https://api.semaphore.co/api/v4/messages", {
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
        ? `Semaphore rejected the SMS with status ${failedMessage.status ?? "failed"}.`
        : "Unable to send SMS notification.");

    if (!response.ok || failedMessage) {
      console.error("[sms] Rental notification send failed", {
        errorMessage,
        hasSenderName: includeSenderName && Boolean(senderName),
        mobile: maskMobileForLogs(normalizedMobile),
        status: response.status,
      });
      throw new Error(errorMessage);
    }

    console.info("[sms] Rental notification sent", {
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
      console.warn("[sms] Retrying rental notification without sender name", {
        mobile: maskMobileForLogs(mobile),
      });
      await sendRequest(false);
      return;
    }

    throw error;
  }
}
