import { describe, expect, it } from "vitest";
import {
  FailureObservedDetailsSchema,
  FailureObservedIncidentEventSchema,
  IncidentEventSchema,
  NotificationQueuedDetailsSchema,
  NotificationQueuedIncidentEventSchema,
  OpenedDetailsSchema,
  OpenedIncidentEventSchema,
  RecoveryObservedDetailsSchema,
  RecoveryObservedIncidentEventSchema,
  ResolvedDetailsSchema,
  ResolvedIncidentEventSchema,
} from "./incident-events.js";

const eventId = "550e8400-e29b-41d4-a716-446655440000";
const incidentId = "018f4f1c-6f4a-4abc-9234-1234567890ab";
const deliveryId = "b7d6f4a6-0b1d-4b55-9a34-5072f6116c43";
const channelId = "7263b827-013d-4426-8657-e2ea2bc1f3f1";
const occurredAt = "2026-07-22T12:34:56Z";
const timeoutCause = {
  category: "timeout",
  code: "ETIMEDOUT",
  httpStatus: null,
  safeSummary: "Request timed out",
} as const;
const networkCause = {
  category: "network",
  code: "ENETUNREACH",
  httpStatus: null,
  safeSummary: "Network unavailable",
} as const;

const commonEvent = { id: eventId, incidentId, occurredAt } as const;
const openedEvent = {
  ...commonEvent,
  type: "opened",
  details: { cause: timeoutCause },
} as const;
const failureObservedEvent = {
  ...commonEvent,
  type: "failure_observed",
  details: { previousCause: timeoutCause, nextCause: networkCause },
} as const;
const notificationQueuedEvent = {
  ...commonEvent,
  type: "notification_queued",
  details: { deliveryId, channelId, payloadVersion: "opspulse.webhook.v1" },
} as const;
const recoveryObservedEvent = {
  ...commonEvent,
  type: "recovery_observed",
  details: { consecutiveSuccesses: 1, recoveryThreshold: 2 },
} as const;
const resolvedEvent = {
  ...commonEvent,
  type: "resolved",
  details: { reason: "recovered" },
} as const;

describe("incident event valid branches", () => {
  it("accepts an exact opened event", () => {
    expect(OpenedDetailsSchema.parse(openedEvent.details)).toEqual(openedEvent.details);
    expect(OpenedIncidentEventSchema.parse(openedEvent)).toEqual(openedEvent);
    expect(IncidentEventSchema.parse(openedEvent)).toEqual(openedEvent);
  });

  it("accepts an exact failure_observed event", () => {
    expect(FailureObservedDetailsSchema.parse(failureObservedEvent.details)).toEqual(
      failureObservedEvent.details,
    );
    expect(FailureObservedIncidentEventSchema.parse(failureObservedEvent)).toEqual(
      failureObservedEvent,
    );
    expect(IncidentEventSchema.parse(failureObservedEvent)).toEqual(failureObservedEvent);
  });

  it("accepts an exact notification_queued event", () => {
    expect(NotificationQueuedDetailsSchema.parse(notificationQueuedEvent.details)).toEqual(
      notificationQueuedEvent.details,
    );
    expect(NotificationQueuedIncidentEventSchema.parse(notificationQueuedEvent)).toEqual(
      notificationQueuedEvent,
    );
    expect(IncidentEventSchema.parse(notificationQueuedEvent)).toEqual(notificationQueuedEvent);
  });

  it("accepts an exact recovery_observed event", () => {
    expect(RecoveryObservedDetailsSchema.parse(recoveryObservedEvent.details)).toEqual(
      recoveryObservedEvent.details,
    );
    expect(RecoveryObservedIncidentEventSchema.parse(recoveryObservedEvent)).toEqual(
      recoveryObservedEvent,
    );
    expect(IncidentEventSchema.parse(recoveryObservedEvent)).toEqual(recoveryObservedEvent);
  });

  it("accepts exact resolved events for both shared resolution reasons", () => {
    expect(ResolvedDetailsSchema.parse(resolvedEvent.details)).toEqual(resolvedEvent.details);
    expect(ResolvedIncidentEventSchema.parse(resolvedEvent)).toEqual(resolvedEvent);
    expect(IncidentEventSchema.parse(resolvedEvent)).toEqual(resolvedEvent);
    expect(IncidentEventSchema.safeParse({
      ...resolvedEvent,
      details: { reason: "monitor_archived" },
    }).success).toBe(true);
  });
});

describe("incident event rejection cases", () => {
  it("rejects resolved details on an opened event", () => {
    expect(IncidentEventSchema.safeParse({ ...openedEvent, details: resolvedEvent.details }).success).toBe(
      false,
    );
  });

  it("rejects opened details on a failure_observed event", () => {
    expect(IncidentEventSchema.safeParse({
      ...failureObservedEvent,
      details: openedEvent.details,
    }).success).toBe(false);
  });

  it("rejects recovery details on a notification_queued event", () => {
    expect(IncidentEventSchema.safeParse({
      ...notificationQueuedEvent,
      details: recoveryObservedEvent.details,
    }).success).toBe(false);
  });

  it("rejects notification details on a recovery_observed event", () => {
    expect(IncidentEventSchema.safeParse({
      ...recoveryObservedEvent,
      details: notificationQueuedEvent.details,
    }).success).toBe(false);
  });

  it("rejects failure details on a resolved event", () => {
    expect(IncidentEventSchema.safeParse({
      ...resolvedEvent,
      details: failureObservedEvent.details,
    }).success).toBe(false);
  });

  it("rejects malformed nested failure causes", () => {
    const result = IncidentEventSchema.safeParse({
      ...failureObservedEvent,
      details: {
        ...failureObservedEvent.details,
        nextCause: { ...networkCause, httpStatus: 503 },
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["details", "nextCause", "httpStatus"]);
    }
  });

  it("rejects payload version near-misses", () => {
    expect(IncidentEventSchema.safeParse({
      ...notificationQueuedEvent,
      details: { ...notificationQueuedEvent.details, payloadVersion: "opspulse.webhook.v2" },
    }).success).toBe(false);
  });

  it("rejects unsafe recovery counts", () => {
    for (const consecutiveSuccesses of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(IncidentEventSchema.safeParse({
        ...recoveryObservedEvent,
        details: { ...recoveryObservedEvent.details, consecutiveSuccesses },
      }).success).toBe(false);
    }
  });

  it("rejects recovery thresholds outside integer 1 through 10", () => {
    for (const recoveryThreshold of [0, 11, 1.5]) {
      expect(IncidentEventSchema.safeParse({
        ...recoveryObservedEvent,
        details: { ...recoveryObservedEvent.details, recoveryThreshold },
      }).success).toBe(false);
    }
  });

  it("rejects unknown event keys", () => {
    expect(IncidentEventSchema.safeParse({ ...openedEvent, sequence: 1 }).success).toBe(false);
  });

  it("rejects unknown detail keys", () => {
    expect(IncidentEventSchema.safeParse({
      ...openedEvent,
      details: { ...openedEvent.details, internalMessage: "secret" },
    }).success).toBe(false);
  });

  it("rejects unknown event types instead of accepting generic details", () => {
    expect(IncidentEventSchema.safeParse({
      ...openedEvent,
      type: "updated",
      details: {},
    }).success).toBe(false);
  });

  it("rejects invalid common IDs and timestamps", () => {
    expect(IncidentEventSchema.safeParse({ ...openedEvent, id: "not-an-id" }).success).toBe(false);
    expect(IncidentEventSchema.safeParse({ ...openedEvent, incidentId: "not-an-id" }).success).toBe(
      false,
    );
    expect(IncidentEventSchema.safeParse({ ...openedEvent, occurredAt: "not-a-time" }).success).toBe(
      false,
    );
  });
});
