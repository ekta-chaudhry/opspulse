import {
  recordNotificationAttempt,
  type NotificationAttemptInput,
  type NotificationDeliveryWorkItem,
  type TransactionPool,
} from "@opspulse/database";
import { signedWebhookHeaders } from "@opspulse/domain";

export type WebhookSendRequest = {
  url: string;
  body: string;
  headers: Record<string, string>;
  timeoutMs: number;
  signal?: AbortSignal;
};

export type WebhookSendResult =
  | { ok: true; status: number }
  | { ok: false; status: number | null; safeError: string | null };

export type NotifierDependencies = {
  send(request: WebhookSendRequest): Promise<WebhookSendResult>;
  recordAttempt(
    deliveryId: string,
    attempt: NotificationAttemptInput,
  ): Promise<void>;
};

export const WEBHOOK_DELIVERY_TIMEOUT_MS = 5_000;

function payloadOccurredAt(payload: unknown): string {
  if (typeof payload !== "object" || payload === null || !("occurredAt" in payload)) {
    throw new TypeError("webhook payload must contain occurredAt");
  }
  const occurredAt = (payload as { occurredAt?: unknown }).occurredAt;
  if (typeof occurredAt !== "string") throw new TypeError("webhook occurredAt must be a string");
  return occurredAt;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function classify(result: WebhookSendResult): NotificationAttemptInput {
  if (result.ok) {
    return { outcome: "delivered", responseStatus: result.status, safeError: null };
  }
  if (result.status === null || isRetryableStatus(result.status)) {
    return {
      outcome: "retryable_failure",
      responseStatus: result.status,
      safeError: result.safeError,
    };
  }
  return {
    outcome: "final_failure",
    responseStatus: result.status,
    safeError: result.safeError,
  };
}

export async function deliverNotification(
  workItem: NotificationDeliveryWorkItem,
  dependencies: NotifierDependencies,
  signal?: AbortSignal,
): Promise<void> {
  const body = JSON.stringify(workItem.payload);
  const occurredAt = payloadOccurredAt(workItem.payload);
  const result = await dependencies.send({
    url: workItem.webhookUrl,
    body,
    headers: signedWebhookHeaders({
      eventId: workItem.incidentEventId,
      occurredAt,
      body,
      secret: workItem.signingSecret,
      replayOfDeliveryId: workItem.replayOfDeliveryId,
    }),
    timeoutMs: WEBHOOK_DELIVERY_TIMEOUT_MS,
    ...(signal === undefined ? {} : { signal }),
  });
  await dependencies.recordAttempt(workItem.id, classify(result));
}

export function defaultNotifierDependencies(pool: TransactionPool): NotifierDependencies {
  return {
    send: sendWebhook,
    recordAttempt: (deliveryId, attempt) => {
      return recordNotificationAttempt(pool, deliveryId, attempt);
    },
  };
}

export async function sendWebhook(request: WebhookSendRequest): Promise<WebhookSendResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, request.timeoutMs);
  const abortListener = (): void => {
    controller.abort();
  };
  request.signal?.addEventListener("abort", abortListener, { once: true });
  try {
    const response = await fetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: request.body,
      redirect: "manual",
      signal: controller.signal,
    });
    await response.body?.cancel().catch(() => undefined);
    if (response.status >= 200 && response.status <= 299) {
      return { ok: true, status: response.status };
    }
    return { ok: false, status: response.status, safeError: `Webhook returned HTTP ${String(response.status)}` };
  } catch {
    const aborted = controller.signal.aborted || request.signal?.aborted === true;
    return {
      ok: false,
      status: null,
      safeError: aborted ? "Webhook delivery timed out" : "Webhook delivery failed",
    };
  } finally {
    clearTimeout(timeout);
    request.signal?.removeEventListener("abort", abortListener);
  }
}
