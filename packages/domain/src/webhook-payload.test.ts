import { describe, expect, it } from "vitest";
import {
  buildIncidentOpenedWebhook,
  buildIncidentResolvedWebhook,
  serializeWebhookPayload,
} from "./webhook-payload.js";

const cause = {
  category: "dns" as const,
  code: "ENOTFOUND",
  httpStatus: null,
  safeSummary: "Target hostname could not be resolved",
};

describe("webhook payload builders", () => {
  it("builds a contract-valid incident opened payload", () => {
    const payload = buildIncidentOpenedWebhook({
      eventId: "11111111-1111-4111-8111-111111111111",
      occurredAt: "2026-07-22T12:00:00.000Z",
      monitor: { slug: "payments-api", name: "Payments API", state: "down" },
      incident: {
        id: "22222222-2222-4222-8222-222222222222",
        startedAt: "2026-07-22T12:00:00.000Z",
      },
      cause,
    });

    expect(payload).toEqual({
      version: "opspulse.webhook.v1",
      eventId: "11111111-1111-4111-8111-111111111111",
      eventType: "incident.opened",
      occurredAt: "2026-07-22T12:00:00.000Z",
      monitor: { slug: "payments-api", name: "Payments API", state: "down" },
      incident: {
        id: "22222222-2222-4222-8222-222222222222",
        startedAt: "2026-07-22T12:00:00.000Z",
        resolvedAt: null,
      },
      summary: {
        message: "Target hostname could not be resolved",
        cause,
        resolution: null,
      },
    });
  });

  it("builds and serializes a contract-valid incident resolved payload", () => {
    const payload = buildIncidentResolvedWebhook({
      eventId: "11111111-1111-4111-8111-111111111111",
      occurredAt: "2026-07-22T12:10:00.000Z",
      monitor: { slug: "payments-api", name: "Payments API", state: "up" },
      incident: {
        id: "22222222-2222-4222-8222-222222222222",
        startedAt: "2026-07-22T12:00:00.000Z",
        resolvedAt: "2026-07-22T12:10:00.000Z",
      },
      resolution: "recovered",
    });

    expect(payload.eventType).toBe("incident.resolved");
    expect(payload.summary).toEqual({
      message: "Monitor recovered",
      cause: null,
      resolution: "recovered",
    });
    expect(JSON.parse(serializeWebhookPayload(payload))).toEqual(payload);
  });
});
