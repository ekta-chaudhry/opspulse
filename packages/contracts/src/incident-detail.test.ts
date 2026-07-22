import { describe, expect, it } from "vitest";
import { IncidentDetailResponseSchema } from "./incident-detail.js";

const incidentId = "550e8400-e29b-41d4-a716-446655440000";
const monitorId = "018f4f1c-6f4a-4abc-9234-1234567890ab";
const eventId = "b7d6f4a6-0b1d-4b55-9a34-5072f6116c43";
const deliveryId = "7263b827-013d-4426-8657-e2ea2bc1f3f1";
const secondDeliveryId = "5f5502a0-38ef-4aad-9f9a-d9311716da2e";
const channelId = "2bd75d4f-a17b-4b4c-9f96-6c9d8fd786aa";
const notificationEventId = "35e6d1c3-64ef-4a32-b2e4-b8184c516aea";
const timestamp = "2026-07-22T12:00:00.0001Z";
const nextAttemptAt = "2026-07-22T12:05:00Z";
const cause = {
  category: "timeout",
  code: "ETIMEDOUT",
  httpStatus: null,
  safeSummary: "Request timed out",
} as const;
const incident = {
  id: incidentId,
  monitorId,
  monitorName: "API health",
  status: "open",
  startedAt: timestamp,
  resolvedAt: null,
  openingCause: cause,
  latestCause: cause,
  resolutionReason: null,
} as const;
const timelineEvent = {
  id: eventId,
  incidentId,
  occurredAt: timestamp,
  type: "opened",
  details: { cause },
} as const;
const delivery = {
  id: deliveryId,
  incidentEventId: eventId,
  channelId,
  deduplicationKey: "incident-event:channel",
  replayOfDeliveryId: null,
  attemptCount: 0,
  lastResponseStatus: null,
  lastSafeError: null,
  nextAttemptAt,
  attempts: [],
  createdAt: timestamp,
  updatedAt: timestamp,
  status: "queued",
} as const;
const notificationQueuedEvent = {
  id: notificationEventId,
  incidentId,
  occurredAt: timestamp,
  type: "notification_queued",
  details: {
    deliveryId,
    channelId,
    payloadVersion: "opspulse.webhook.v1",
  },
} as const;
const response = {
  incident,
  timeline: [timelineEvent],
  deliveries: [delivery],
} as const;

describe("incident detail response", () => {
  it("accepts the exact composed owner envelope", () => {
    expect(IncidentDetailResponseSchema.parse(response)).toEqual(response);
  });

  it("accepts empty timeline and delivery arrays", () => {
    const emptyResponse = { incident, timeline: [], deliveries: [] } as const;
    expect(IncidentDetailResponseSchema.parse(emptyResponse)).toEqual(emptyResponse);
  });

  it("rejects unknown top-level fields", () => {
    expect(IncidentDetailResponseSchema.safeParse({
      ...response,
      internalMetadata: {},
    }).success).toBe(false);
  });

  it("preserves the incident owner allowlist", () => {
    expect(IncidentDetailResponseSchema.safeParse({
      ...response,
      incident: { ...incident, internalNotes: "secret" },
    }).success).toBe(false);
    expect(IncidentDetailResponseSchema.safeParse({
      ...response,
      incident: { ...incident, id: "not-an-id" },
    }).success).toBe(false);
  });

  it("preserves timeline owner and nested detail allowlists", () => {
    expect(IncidentDetailResponseSchema.safeParse({
      ...response,
      timeline: [{ ...timelineEvent, sequence: 1 }],
    }).success).toBe(false);
    expect(IncidentDetailResponseSchema.safeParse({
      ...response,
      timeline: [{
        ...timelineEvent,
        details: { ...timelineEvent.details, internalError: "secret" },
      }],
    }).success).toBe(false);
    expect(IncidentDetailResponseSchema.safeParse({
      ...response,
      timeline: [{
        ...timelineEvent,
        details: { cause: { ...cause, httpStatus: 500 } },
      }],
    }).success).toBe(false);
  });

  it("preserves delivery owner and nested attempt allowlists", () => {
    expect(IncidentDetailResponseSchema.safeParse({
      ...response,
      deliveries: [{ ...delivery, payload: { signingSecret: "secret" } }],
    }).success).toBe(false);
    expect(IncidentDetailResponseSchema.safeParse({
      ...response,
      deliveries: [{
        ...delivery,
        attemptCount: 1,
        attempts: [{
          id: channelId,
          deliveryId,
          attemptNumber: 1,
          startedAt: timestamp,
          completedAt: timestamp,
          outcome: "delivered",
          responseStatus: 204,
          safeError: null,
          internalError: "secret",
        }],
      }],
    }).success).toBe(false);
    expect(IncidentDetailResponseSchema.safeParse({
      ...response,
      deliveries: [{ ...delivery, attemptCount: 1 }],
    }).success).toBe(false);
  });

  it("matches every timeline event to the envelope incident case-insensitively", () => {
    expect(IncidentDetailResponseSchema.safeParse({
      ...response,
      incident: { ...incident, id: incidentId.toUpperCase() },
    }).success).toBe(true);
    const result = IncidentDetailResponseSchema.safeParse({
      ...response,
      timeline: [{ ...timelineEvent, incidentId: monitorId }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["timeline", 0, "incidentId"]);
      expect(result.error.issues[0]?.message).toBe(
        "timeline incidentId must match envelope incident id",
      );
    }
  });

  it("requires canonically unique timeline event IDs", () => {
    const result = IncidentDetailResponseSchema.safeParse({
      ...response,
      timeline: [timelineEvent, { ...timelineEvent, id: eventId.toUpperCase() }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["timeline", 1, "id"]);
      expect(result.error.issues[0]?.message).toBe("timeline event ids must be unique");
    }
  });

  it("resolves every delivery incidentEventId to a timeline event case-insensitively", () => {
    expect(IncidentDetailResponseSchema.safeParse({
      ...response,
      deliveries: [{ ...delivery, incidentEventId: eventId.toUpperCase() }],
    }).success).toBe(true);
    const result = IncidentDetailResponseSchema.safeParse({
      ...response,
      deliveries: [{ ...delivery, incidentEventId: monitorId }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["deliveries", 0, "incidentEventId"]);
      expect(result.error.issues[0]?.message).toBe(
        "delivery incidentEventId must reference a timeline event",
      );
    }
  });

  it("requires canonically unique delivery IDs", () => {
    const result = IncidentDetailResponseSchema.safeParse({
      ...response,
      deliveries: [delivery, {
        ...delivery,
        id: deliveryId.toUpperCase(),
        deduplicationKey: "second",
      }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["deliveries", 1, "id"]);
      expect(result.error.issues[0]?.message).toBe("delivery ids must be unique");
    }
  });

  it("does not resolve channelId against absent channel resources", () => {
    expect(IncidentDetailResponseSchema.safeParse({
      ...response,
      deliveries: [{ ...delivery, id: secondDeliveryId, channelId: monitorId }],
    }).success).toBe(true);
  });

  it("allows deliveries to reference only opened or resolved transition events", () => {
    const invalidSourceEvents = [
      {
        ...timelineEvent,
        type: "failure_observed",
        details: { previousCause: cause, nextCause: cause },
      },
      {
        ...timelineEvent,
        type: "recovery_observed",
        details: { consecutiveSuccesses: 1, recoveryThreshold: 1 },
      },
      {
        ...timelineEvent,
        type: "notification_queued",
        details: notificationQueuedEvent.details,
      },
    ] as const;
    for (const sourceEvent of invalidSourceEvents) {
      const result = IncidentDetailResponseSchema.safeParse({
        ...response,
        timeline: [sourceEvent],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((issue) =>
          issue.path.join(".") === "deliveries.0.incidentEventId" &&
            issue.message ===
              "delivery incidentEventId must reference an opened or resolved timeline event"
        )).toBe(true);
      }
    }
  });

  it("requires notification_queued deliveryId to resolve to an envelope delivery", () => {
    const result = IncidentDetailResponseSchema.safeParse({
      ...response,
      timeline: [timelineEvent, {
        ...notificationQueuedEvent,
        details: { ...notificationQueuedEvent.details, deliveryId: secondDeliveryId },
      }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual([
        "timeline",
        1,
        "details",
        "deliveryId",
      ]);
      expect(result.error.issues[0]?.message).toBe(
        "notification_queued deliveryId must reference an envelope delivery",
      );
    }
  });

  it("requires notification_queued channelId to match its resolved delivery", () => {
    const result = IncidentDetailResponseSchema.safeParse({
      ...response,
      timeline: [timelineEvent, {
        ...notificationQueuedEvent,
        details: { ...notificationQueuedEvent.details, channelId: monitorId },
      }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual([
        "timeline",
        1,
        "details",
        "channelId",
      ]);
      expect(result.error.issues[0]?.message).toBe(
        "notification_queued channelId must match delivery channelId",
      );
    }
  });

  it("accepts opened and resolved delivery sources with a matching queued event", () => {
    const resolvedSourceEvent = {
      ...timelineEvent,
      type: "resolved",
      details: { reason: "recovered" },
    } as const;
    for (const sourceEvent of [timelineEvent, resolvedSourceEvent]) {
      expect(IncidentDetailResponseSchema.safeParse({
        ...response,
        timeline: [sourceEvent, {
          ...notificationQueuedEvent,
          details: {
            ...notificationQueuedEvent.details,
            deliveryId: deliveryId.toUpperCase(),
            channelId: channelId.toUpperCase(),
          },
        }],
        deliveries: [{ ...delivery, incidentEventId: sourceEvent.id.toUpperCase() }],
      }).success).toBe(true);
    }
  });
});
