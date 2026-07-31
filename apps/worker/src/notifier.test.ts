import { WEBHOOK_HEADER_NAMES } from "@opspulse/contracts";
import type { NotificationDeliveryWorkItem } from "@opspulse/database";
import { describe, expect, it, vi } from "vitest";
import {
  deliverNotification,
  sendWebhook,
  WEBHOOK_DELIVERY_TIMEOUT_MS,
  type WebhookSendRequest,
  type WebhookSendResult,
} from "./notifier.js";

const workItem: NotificationDeliveryWorkItem = {
  id: "11111111-1111-4111-8111-111111111111",
  incidentEventId: "22222222-2222-4222-8222-222222222222",
  channelId: "33333333-3333-4333-8333-333333333333",
  webhookUrl: "https://hooks.example.test/opspulse",
  signingSecret: "x".repeat(32),
  payload: {
    version: "opspulse.webhook.v1",
    eventId: "22222222-2222-4222-8222-222222222222",
    eventType: "incident.opened",
    occurredAt: "2026-07-22T12:00:00.000Z",
  },
  attemptCount: 0,
  replayOfDeliveryId: null,
};

describe("deliverNotification", () => {
  it("sends a signed webhook and records delivery on 2xx", async () => {
    const send = vi.fn<(request: WebhookSendRequest) => Promise<WebhookSendResult>>(() =>
      Promise.resolve({ ok: true, status: 204 }),
    );
    const recordAttempt = vi.fn(() => Promise.resolve());

    await deliverNotification(workItem, { send, recordAttempt });

    const request = send.mock.calls[0]?.[0];
    expect(request).toBeDefined();
    const sent = request as WebhookSendRequest;
    expect(sent.url).toBe(workItem.webhookUrl);
    expect(sent.timeoutMs).toBe(WEBHOOK_DELIVERY_TIMEOUT_MS);
    expect(sent.body).toBe(JSON.stringify(workItem.payload));
    expect(sent.headers[WEBHOOK_HEADER_NAMES.eventId]).toBe(workItem.incidentEventId);
    expect(sent.headers[WEBHOOK_HEADER_NAMES.timestamp]).toBe("2026-07-22T12:00:00.000Z");
    expect(sent.headers[WEBHOOK_HEADER_NAMES.signature]).toMatch(/^v1=[0-9a-f]{64}$/u);
    expect(recordAttempt).toHaveBeenCalledWith(workItem.id, {
      outcome: "delivered",
      responseStatus: 204,
      safeError: null,
    });
  });

  it("records retryable failures for 429, 5xx, and network errors", async () => {
    for (const result of [
      { ok: false as const, status: 429, safeError: "Webhook returned HTTP 429" },
      { ok: false as const, status: 500, safeError: "Webhook returned HTTP 500" },
      { ok: false as const, status: null, safeError: "Webhook delivery failed" },
    ]) {
      const recordAttempt = vi.fn(() => Promise.resolve());
      await deliverNotification(workItem, {
        send: vi.fn(() => Promise.resolve(result)),
        recordAttempt,
      });
      expect(recordAttempt).toHaveBeenCalledWith(workItem.id, {
        outcome: "retryable_failure",
        responseStatus: result.status,
        safeError: result.safeError,
      });
    }
  });

  it("records final failures for non-retryable 4xx responses", async () => {
    const recordAttempt = vi.fn(() => Promise.resolve());

    await deliverNotification(workItem, {
      send: vi.fn(() => Promise.resolve({
        ok: false as const,
        status: 400,
        safeError: "Webhook returned HTTP 400",
      })),
      recordAttempt,
    });

    expect(recordAttempt).toHaveBeenCalledWith(workItem.id, {
      outcome: "final_failure",
      responseStatus: 400,
      safeError: "Webhook returned HTTP 400",
    });
  });

  it("includes replay header for replay deliveries", async () => {
    const send = vi.fn<(request: WebhookSendRequest) => Promise<WebhookSendResult>>(() =>
      Promise.resolve({ ok: true, status: 200 }),
    );

    await deliverNotification({
      ...workItem,
      replayOfDeliveryId: "44444444-4444-4444-8444-444444444444",
    }, { send, recordAttempt: vi.fn(() => Promise.resolve()) });

    const request = send.mock.calls[0]?.[0];
    expect(request).toBeDefined();
    expect((request as WebhookSendRequest).headers[WEBHOOK_HEADER_NAMES.replayOf]).toBe(
      "44444444-4444-4444-8444-444444444444",
    );
  });
});

describe("sendWebhook", () => {
  it("maps fetch HTTP responses without following redirects", async () => {
    const originalFetch = globalThis.fetch;
    const cancel = vi.fn(() => Promise.resolve());
    globalThis.fetch = vi.fn(() => Promise.resolve({
      status: 302,
      body: { cancel },
    } as unknown as Response));
    try {
      const result = await sendWebhook({
        url: "https://hooks.example.test/opspulse",
        body: "{}",
        headers: {},
        timeoutMs: 5000,
      });
      expect(result).toEqual({
        ok: false,
        status: 302,
        safeError: "Webhook returned HTTP 302",
      });
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://hooks.example.test/opspulse",
        expect.objectContaining({ method: "POST", redirect: "manual" }),
      );
      expect(cancel).toHaveBeenCalledOnce();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
