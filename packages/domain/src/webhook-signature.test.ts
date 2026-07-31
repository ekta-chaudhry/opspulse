import { WEBHOOK_HEADER_NAMES } from "@opspulse/contracts";
import { describe, expect, it } from "vitest";
import {
  signedWebhookHeaders,
  signWebhookBody,
  verifyWebhookSignature,
  WEBHOOK_SIGNATURE_VERSION,
} from "./webhook-signature.js";

describe("webhook signatures", () => {
  it("signs the timestamp and raw body with HMAC-SHA256", () => {
    const signature = signWebhookBody(
      "super-secret",
      "2026-07-22T12:00:00.000Z",
      JSON.stringify({ eventId: "evt_1" }),
    );

    expect(signature).toMatch(/^v1=[0-9a-f]{64}$/u);
    expect(signature).toBe(
      signWebhookBody(
        "super-secret",
        "2026-07-22T12:00:00.000Z",
        JSON.stringify({ eventId: "evt_1" }),
      ),
    );
    expect(verifyWebhookSignature(
      "super-secret",
      "2026-07-22T12:00:00.000Z",
      JSON.stringify({ eventId: "evt_1" }),
      signature,
    )).toBe(true);
    expect(verifyWebhookSignature(
      "wrong-secret",
      "2026-07-22T12:00:00.000Z",
      JSON.stringify({ eventId: "evt_1" }),
      signature,
    )).toBe(false);
  });

  it("builds exact delivery headers and adds replay metadata only for replays", () => {
    const body = JSON.stringify({ eventId: "11111111-1111-4111-8111-111111111111" });
    const headers = signedWebhookHeaders({
      eventId: "11111111-1111-4111-8111-111111111111",
      occurredAt: "2026-07-22T12:00:00.000Z",
      body,
      secret: "super-secret",
    });

    expect(headers["content-type"]).toBe("application/json");
    expect(headers[WEBHOOK_HEADER_NAMES.eventId]).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(headers[WEBHOOK_HEADER_NAMES.timestamp]).toBe("2026-07-22T12:00:00.000Z");
    expect(headers[WEBHOOK_HEADER_NAMES.signatureVersion]).toBe(WEBHOOK_SIGNATURE_VERSION);
    expect(headers[WEBHOOK_HEADER_NAMES.signature]).toMatch(/^v1=[0-9a-f]{64}$/u);
    expect(headers).not.toHaveProperty(WEBHOOK_HEADER_NAMES.replayOf);

    const replayHeaders = signedWebhookHeaders({
      eventId: "11111111-1111-4111-8111-111111111111",
      occurredAt: "2026-07-22T12:00:00.000Z",
      body,
      secret: "super-secret",
      replayOfDeliveryId: "22222222-2222-4222-8222-222222222222",
    });
    expect(replayHeaders[WEBHOOK_HEADER_NAMES.replayOf]).toBe(
      "22222222-2222-4222-8222-222222222222",
    );
  });
});
