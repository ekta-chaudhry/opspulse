import { describe, expect, it } from "vitest";
import { IncidentDetailResponseSchema } from "./incident-detail.js";

const incidentId = "550e8400-e29b-41d4-a716-446655440000";
const monitorId = "018f4f1c-6f4a-4abc-9234-1234567890ab";
const eventId = "b7d6f4a6-0b1d-4b55-9a34-5072f6116c43";
const deliveryId = "7263b827-013d-4426-8657-e2ea2bc1f3f1";
const channelId = "2bd75d4f-a17b-4b4c-9f96-6c9d8fd786aa";
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
});
