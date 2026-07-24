import { describe, expect, expectTypeOf, it } from "vitest";
import {
  OpenedWebhookSchema,
  OpsPulseWebhookV1Schema,
  ResolvedWebhookSchema,
  WEBHOOK_HEADER_NAMES,
  WEBHOOK_PAYLOAD_VERSION,
  WebhookEventTypeSchema,
} from "./webhook.js";

const eventId = "550e8400-e29b-41d4-a716-446655440000";
const incidentId = "018f4f1c-6f4a-4abc-9234-1234567890ab";
const startedAt = "2026-07-22T12:00:00.0001Z";
const resolvedAt = "2026-07-22T12:00:00.0009Z";
const cause = {
  category: "http_status",
  code: "HTTP_503",
  httpStatus: 503,
  safeSummary: "Service unavailable",
} as const;
const monitor = {
  slug: "api-health",
  name: "API health",
  state: "down",
} as const;
const baseWebhook = {
  version: "opspulse.webhook.v1",
  eventId,
  occurredAt: startedAt,
  monitor,
} as const;
const openedWebhook = {
  ...baseWebhook,
  eventType: "incident.opened",
  incident: { id: incidentId, startedAt, resolvedAt: null },
  summary: {
    message: "API health is down",
    cause,
    resolution: null,
  },
} as const;
const recoveredWebhook = {
  ...baseWebhook,
  occurredAt: resolvedAt,
  eventType: "incident.resolved",
  monitor: { ...monitor, state: "up" },
  incident: { id: incidentId, startedAt, resolvedAt },
  summary: {
    message: "API health recovered",
    cause: null,
    resolution: "recovered",
  },
} as const;
const archivedWebhook = {
  ...baseWebhook,
  occurredAt: resolvedAt,
  eventType: "incident.resolved",
  incident: { id: incidentId, startedAt, resolvedAt },
  summary: {
    message: "API health was archived",
    cause: null,
    resolution: "monitor_archived",
  },
} as const;

describe("webhook constants", () => {
  it("exposes the exact payload version and event types", () => {
    expect(WEBHOOK_PAYLOAD_VERSION).toBe("opspulse.webhook.v1");
    expect(WebhookEventTypeSchema.options).toEqual(["incident.opened", "incident.resolved"]);
    expect(WebhookEventTypeSchema.safeParse("incident.updated").success).toBe(false);
  });

  it("exposes the exact frozen logical header map", () => {
    expect(WEBHOOK_HEADER_NAMES).toEqual({
      eventId: "X-OpsPulse-Event-ID",
      timestamp: "X-OpsPulse-Timestamp",
      signatureVersion: "X-OpsPulse-Signature-Version",
      signature: "X-OpsPulse-Signature",
      replayOf: "X-OpsPulse-Replay-Of",
    });
    expect(Object.keys(WEBHOOK_HEADER_NAMES)).toEqual([
      "eventId",
      "timestamp",
      "signatureVersion",
      "signature",
      "replayOf",
    ]);
    expect(Object.isFrozen(WEBHOOK_HEADER_NAMES)).toBe(true);
    expectTypeOf(WEBHOOK_HEADER_NAMES).toEqualTypeOf<Readonly<{
      eventId: "X-OpsPulse-Event-ID";
      timestamp: "X-OpsPulse-Timestamp";
      signatureVersion: "X-OpsPulse-Signature-Version";
      signature: "X-OpsPulse-Signature";
      replayOf: "X-OpsPulse-Replay-Of";
    }>>();
  });
});

describe("opened webhooks", () => {
  it("accepts the exact opened branch with required nulls", () => {
    expect(OpenedWebhookSchema.parse(openedWebhook)).toEqual(openedWebhook);
    expect(OpsPulseWebhookV1Schema.parse(openedWebhook)).toEqual(openedWebhook);
  });

  it("requires a down monitor, unresolved incident, cause, and null resolution", () => {
    for (const value of [
      { ...openedWebhook, monitor: { ...monitor, state: "up" } },
      { ...openedWebhook, incident: { ...openedWebhook.incident, resolvedAt } },
      { ...openedWebhook, summary: { ...openedWebhook.summary, cause: null } },
      { ...openedWebhook, summary: { ...openedWebhook.summary, resolution: "recovered" } },
    ]) {
      expect(OpenedWebhookSchema.safeParse(value).success).toBe(false);
      expect(OpsPulseWebhookV1Schema.safeParse(value).success).toBe(false);
    }
  });

  it("uses shared monitor slug, normalized name, safe message, and cause validation", () => {
    expect(OpenedWebhookSchema.parse({
      ...openedWebhook,
      monitor: { ...monitor, name: "  API health  " },
      summary: { ...openedWebhook.summary, message: "  API is down  " },
    })).toMatchObject({
      monitor: { name: "API health" },
      summary: { message: "API is down" },
    });
    for (const value of [
      { ...openedWebhook, monitor: { ...monitor, slug: "API Health" } },
      { ...openedWebhook, monitor: { ...monitor, name: " " } },
      { ...openedWebhook, monitor: { ...monitor, name: "n".repeat(101) } },
      { ...openedWebhook, summary: { ...openedWebhook.summary, message: " " } },
      {
        ...openedWebhook,
        summary: { ...openedWebhook.summary, cause: { ...cause, httpStatus: null } },
      },
    ]) {
      expect(OpenedWebhookSchema.safeParse(value).success).toBe(false);
    }
  });

  it("requires occurredAt and startedAt to represent the same instant", () => {
    expect(OpenedWebhookSchema.safeParse({
      ...openedWebhook,
      occurredAt: "2026-07-22T13:00:00.0001000+01:00",
      incident: {
        ...openedWebhook.incident,
        startedAt: "2026-07-22T12:00:00.0001Z",
      },
    }).success).toBe(true);
    for (const occurredAt of [
      "2026-07-22T12:00:00.00009Z",
      "2026-07-22T12:00:00.00011Z",
    ]) {
      const result = OpenedWebhookSchema.safeParse({ ...openedWebhook, occurredAt });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.path).toEqual(["occurredAt"]);
        expect(result.error.issues[0]?.message).toBe(
          "opened occurredAt must represent the same instant as incident startedAt",
        );
      }
    }
  });
});

describe("resolved webhooks", () => {
  it("accepts recovered only when the monitor is up", () => {
    expect(ResolvedWebhookSchema.parse(recoveredWebhook)).toEqual(recoveredWebhook);
    expect(OpsPulseWebhookV1Schema.parse(recoveredWebhook)).toEqual(recoveredWebhook);
    const result = ResolvedWebhookSchema.safeParse({
      ...recoveredWebhook,
      monitor: { ...recoveredWebhook.monitor, state: "degraded" },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["monitor", "state"]);
      expect(result.error.issues[0]?.message).toBe("recovered incidents require an up monitor");
    }
  });

  it("accepts monitor_archived with every monitor state", () => {
    for (const state of ["pending", "up", "degraded", "down"] as const) {
      const value = { ...archivedWebhook, monitor: { ...monitor, state } };
      expect(ResolvedWebhookSchema.safeParse(value).success).toBe(true);
      expect(OpsPulseWebhookV1Schema.safeParse(value).success).toBe(true);
    }
  });

  it("requires a resolved timestamp, null cause, and approved resolution", () => {
    for (const value of [
      { ...recoveredWebhook, incident: { ...recoveredWebhook.incident, resolvedAt: null } },
      { ...recoveredWebhook, summary: { ...recoveredWebhook.summary, cause } },
      { ...recoveredWebhook, summary: { ...recoveredWebhook.summary, resolution: null } },
      { ...recoveredWebhook, summary: { ...recoveredWebhook.summary, resolution: "manual" } },
    ]) {
      expect(ResolvedWebhookSchema.safeParse(value).success).toBe(false);
    }
  });

  it("orders resolvedAt at or after startedAt beyond milliseconds and across offsets", () => {
    const result = ResolvedWebhookSchema.safeParse({
      ...recoveredWebhook,
      incident: { ...recoveredWebhook.incident, startedAt: resolvedAt, resolvedAt: startedAt },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["incident", "resolvedAt"]);
      expect(result.error.issues[0]?.message).toBe(
        "resolvedAt must be greater than or equal to startedAt",
      );
    }
    expect(ResolvedWebhookSchema.safeParse({
      ...recoveredWebhook,
      incident: {
        ...recoveredWebhook.incident,
        startedAt: "2026-07-22T13:00:00.0001+01:00",
        resolvedAt: "2026-07-22T12:00:00.0001Z",
      },
    }).success).toBe(true);
  });

  it("requires resolved occurrence at or after incident resolution", () => {
    expect(ResolvedWebhookSchema.safeParse({
      ...recoveredWebhook,
      occurredAt: "2026-07-22T13:00:00.0009000+01:00",
    }).success).toBe(true);
    const result = ResolvedWebhookSchema.safeParse({
      ...recoveredWebhook,
      occurredAt: "2026-07-22T12:00:00.00089Z",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["occurredAt"]);
      expect(result.error.issues[0]?.message).toBe(
        "occurredAt must be greater than or equal to incident resolvedAt",
      );
    }
  });
});

describe("webhook strictness", () => {
  it("rejects unknown or internal top-level fields", () => {
    for (const privateField of [
      { signingSecret: "secret" },
      { deliveryId: eventId },
      { internalMetadata: {} },
    ]) {
      expect(OpsPulseWebhookV1Schema.safeParse({
        ...openedWebhook,
        ...privateField,
      }).success).toBe(false);
    }
  });

  it("rejects unknown fields in every nested object", () => {
    for (const value of [
      { ...openedWebhook, monitor: { ...openedWebhook.monitor, monitorId: eventId } },
      { ...openedWebhook, incident: { ...openedWebhook.incident, internalStatus: "open" } },
      { ...openedWebhook, summary: { ...openedWebhook.summary, details: "private" } },
      {
        ...openedWebhook,
        summary: {
          ...openedWebhook.summary,
          cause: { ...openedWebhook.summary.cause, internalError: "secret" },
        },
      },
    ]) {
      expect(OpsPulseWebhookV1Schema.safeParse(value).success).toBe(false);
    }
  });

  it("rejects wrong branch keys and malformed common identifiers and timestamps", () => {
    for (const value of [
      { ...openedWebhook, version: "opspulse.webhook.v2" },
      { ...openedWebhook, eventId: "not-an-id" },
      { ...openedWebhook, occurredAt: "not-a-time" },
      { ...openedWebhook, incident: { ...openedWebhook.incident, id: "not-an-id" } },
      { ...openedWebhook, eventType: "incident.resolved" },
      { ...recoveredWebhook, eventType: "incident.opened" },
    ]) {
      expect(OpsPulseWebhookV1Schema.safeParse(value).success).toBe(false);
    }
  });
});
