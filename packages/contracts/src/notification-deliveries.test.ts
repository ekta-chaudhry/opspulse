import { describe, expect, expectTypeOf, it } from "vitest";
import {
  AttemptOutcomeSchema,
  DeliveredDeliverySchema,
  DeliveryListQuerySchema,
  DeliveryListResponseSchema,
  DeliveryStatusSchema,
  FailedDeliverySchema,
  NotificationAttemptSchema,
  NotificationDeliverySchema,
  QueuedDeliverySchema,
  ReplayDeliverySchema,
  RetryingDeliverySchema,
  type NotificationAttempt,
  type NotificationDelivery,
} from "./notification-deliveries.js";

const deliveryId = "550e8400-e29b-41d4-a716-44665544000a";
const incidentEventId = "018f4f1c-6f4a-4abc-9234-1234567890ab";
const channelId = "b7d6f4a6-0b1d-4b55-9a34-5072f6116c43";
const monitorId = "7263b827-013d-4426-8657-e2ea2bc1f3f1";
const attemptId = "2bd75d4f-a17b-4b4c-9f96-6c9d8fd786aa";
const secondAttemptId = "5f5502a0-38ef-4aad-9f9a-d9311716da2e";
const startedAt = "2026-07-22T12:00:00.0001Z";
const completedAt = "2026-07-22T12:00:00.0009Z";
const secondCompletedAt = "2026-07-22T12:00:00.0010Z";
const nextAttemptAt = "2026-07-22T12:05:00Z";

const deliveredAttempt = {
  id: attemptId,
  deliveryId,
  attemptNumber: 1,
  startedAt,
  completedAt,
  outcome: "delivered",
  responseStatus: 204,
  safeError: null,
} as const;
const retryableAttempt = {
  ...deliveredAttempt,
  outcome: "retryable_failure",
  responseStatus: 503,
  safeError: "Service unavailable",
} as const;
const finalAttempt = {
  ...deliveredAttempt,
  outcome: "final_failure",
  responseStatus: null,
  safeError: "Delivery rejected",
} as const;

const commonDelivery = {
  id: deliveryId,
  incidentEventId,
  channelId,
  deduplicationKey: "incident-event:channel",
  replayOfDeliveryId: null,
  createdAt: startedAt,
  updatedAt: completedAt,
} as const;
const queuedDelivery = {
  ...commonDelivery,
  status: "queued",
  attemptCount: 0,
  lastResponseStatus: null,
  lastSafeError: null,
  nextAttemptAt,
  attempts: [],
} as const;
const retryingDelivery = {
  ...commonDelivery,
  status: "retrying",
  attemptCount: 1,
  lastResponseStatus: 503,
  lastSafeError: "Service unavailable",
  nextAttemptAt,
  attempts: [retryableAttempt],
} as const;
const deliveredDelivery = {
  ...commonDelivery,
  status: "delivered",
  attemptCount: 1,
  lastResponseStatus: 204,
  lastSafeError: null,
  nextAttemptAt: null,
  attempts: [deliveredAttempt],
} as const;
const failedDelivery = {
  ...commonDelivery,
  status: "failed",
  attemptCount: 1,
  lastResponseStatus: null,
  lastSafeError: "Delivery rejected",
  nextAttemptAt: null,
  attempts: [finalAttempt],
} as const;

describe("notification attempts", () => {
  it("accepts only approved status and outcome literals", () => {
    expect(DeliveryStatusSchema.options).toEqual(["queued", "retrying", "delivered", "failed"]);
    expect(AttemptOutcomeSchema.options).toEqual([
      "delivered",
      "retryable_failure",
      "final_failure",
    ]);
    expect(DeliveryStatusSchema.safeParse("pending").success).toBe(false);
    expect(AttemptOutcomeSchema.safeParse("failed").success).toBe(false);
  });

  it("accepts exact delivered and failure outcome branches", () => {
    for (const attempt of [deliveredAttempt, retryableAttempt, finalAttempt]) {
      expect(NotificationAttemptSchema.parse(attempt)).toEqual(attempt);
    }
  });

  it("requires delivered outcomes to have a 2xx response and no safe error", () => {
    for (const change of [
      { responseStatus: null },
      { responseStatus: 199 },
      { responseStatus: 300 },
      { safeError: "Unexpected body" },
    ]) {
      expect(NotificationAttemptSchema.safeParse({ ...deliveredAttempt, ...change }).success).toBe(
        false,
      );
    }
  });

  it("requires both failure outcomes to expose a safe response or error", () => {
    for (const outcome of ["retryable_failure", "final_failure"] as const) {
      expect(NotificationAttemptSchema.safeParse({
        ...retryableAttempt,
        outcome,
        responseStatus: null,
        safeError: null,
      }).success).toBe(false);
      expect(NotificationAttemptSchema.safeParse({
        ...retryableAttempt,
        outcome,
        responseStatus: 500,
        safeError: null,
      }).success).toBe(true);
      expect(NotificationAttemptSchema.safeParse({
        ...retryableAttempt,
        outcome,
        responseStatus: null,
        safeError: "Network unavailable",
      }).success).toBe(true);
    }
  });

  it("rejects fields from other outcome branches and unknown fields", () => {
    expect(NotificationAttemptSchema.safeParse({
      ...retryableAttempt,
      outcome: "delivered",
    }).success).toBe(false);
    expect(NotificationAttemptSchema.safeParse({
      ...deliveredAttempt,
      internalError: "secret",
    }).success).toBe(false);
  });

  it("enforces response status, attempt number, and safe message bounds", () => {
    for (const responseStatus of [100, 599]) {
      expect(NotificationAttemptSchema.safeParse({
        ...retryableAttempt,
        responseStatus,
      }).success).toBe(true);
    }
    for (const responseStatus of [99, 600, 200.5]) {
      expect(NotificationAttemptSchema.safeParse({
        ...retryableAttempt,
        responseStatus,
      }).success).toBe(false);
    }
    for (const attemptNumber of [1, 6]) {
      expect(NotificationAttemptSchema.safeParse({
        ...deliveredAttempt,
        attemptNumber,
      }).success).toBe(true);
    }
    for (const attemptNumber of [0, 7, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(NotificationAttemptSchema.safeParse({
        ...deliveredAttempt,
        attemptNumber,
      }).success).toBe(false);
    }
    expect(NotificationAttemptSchema.safeParse({
      ...finalAttempt,
      safeError: ` ${"e".repeat(500)} `,
    }).success).toBe(true);
    for (const safeError of ["", " ", "e".repeat(501)]) {
      expect(NotificationAttemptSchema.safeParse({ ...finalAttempt, safeError }).success).toBe(false);
    }
  });

  it("orders completion at or after start beyond milliseconds and across offsets", () => {
    expect(NotificationAttemptSchema.safeParse(deliveredAttempt).success).toBe(true);
    const reversed = NotificationAttemptSchema.safeParse({
      ...deliveredAttempt,
      startedAt: completedAt,
      completedAt: startedAt,
    });
    expect(reversed.success).toBe(false);
    if (!reversed.success) {
      expect(reversed.error.issues[0]?.path).toEqual(["completedAt"]);
      expect(reversed.error.issues[0]?.message).toBe(
        "completedAt must be greater than or equal to startedAt",
      );
    }
    expect(NotificationAttemptSchema.safeParse({
      ...deliveredAttempt,
      startedAt: "2026-07-22T13:00:00.0001+01:00",
      completedAt: "2026-07-22T12:00:00.0001Z",
    }).success).toBe(true);
  });
});

describe("notification delivery branches", () => {
  it("accepts each exact status branch through its owner and union schemas", () => {
    const branches = [
      [QueuedDeliverySchema, queuedDelivery],
      [RetryingDeliverySchema, retryingDelivery],
      [DeliveredDeliverySchema, deliveredDelivery],
      [FailedDeliverySchema, failedDelivery],
    ] as const;
    for (const [schema, delivery] of branches) {
      expect(schema.parse(delivery)).toEqual(delivery);
      expect(NotificationDeliverySchema.parse(delivery)).toEqual(delivery);
    }
  });

  it("validates the exhaustive status cross-product against branch invariants", () => {
    const samples = [queuedDelivery, retryingDelivery, deliveredDelivery, failedDelivery] as const;
    const statuses = ["queued", "retrying", "delivered", "failed"] as const;
    for (const sample of samples) {
      for (const status of statuses) {
        expect(NotificationDeliverySchema.safeParse({ ...sample, status }).success).toBe(
          status === sample.status,
        );
      }
    }
  });

  it("enforces queued branch invariants", () => {
    expect(QueuedDeliverySchema.safeParse({ ...queuedDelivery, attemptCount: 1 }).success).toBe(false);
    expect(QueuedDeliverySchema.safeParse({
      ...queuedDelivery,
      attempts: [retryableAttempt],
    }).success).toBe(false);
    expect(QueuedDeliverySchema.safeParse({
      ...queuedDelivery,
      lastResponseStatus: 503,
    }).success).toBe(false);
    expect(QueuedDeliverySchema.safeParse({ ...queuedDelivery, lastSafeError: "Error" }).success).toBe(
      false,
    );
    expect(QueuedDeliverySchema.safeParse({ ...queuedDelivery, nextAttemptAt: null }).success).toBe(
      false,
    );
  });

  it("enforces retrying branch invariants", () => {
    for (const change of [
      { attemptCount: 0, attempts: [] },
      { attemptCount: 6 },
      { nextAttemptAt: null },
      { lastResponseStatus: null, lastSafeError: null },
    ]) {
      expect(RetryingDeliverySchema.safeParse({ ...retryingDelivery, ...change }).success).toBe(false);
    }
  });

  it("enforces delivered branch invariants", () => {
    for (const change of [
      { attemptCount: 0, attempts: [] },
      { lastResponseStatus: 199 },
      { lastResponseStatus: 300 },
      { lastSafeError: "Error" },
      { nextAttemptAt },
    ]) {
      expect(DeliveredDeliverySchema.safeParse({ ...deliveredDelivery, ...change }).success).toBe(
        false,
      );
    }
  });

  it("enforces failed branch invariants", () => {
    for (const change of [
      { attemptCount: 0, attempts: [] },
      { nextAttemptAt },
      { lastResponseStatus: null, lastSafeError: null },
    ]) {
      expect(FailedDeliverySchema.safeParse({ ...failedDelivery, ...change }).success).toBe(false);
    }
  });

  it("accepts six attempts and rejects seven", () => {
    const attempts = Array.from({ length: 6 }, (_, index) => ({
      ...retryableAttempt,
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      attemptNumber: index + 1,
      completedAt: startedAt,
    }));
    expect(FailedDeliverySchema.safeParse({
      ...failedDelivery,
      attemptCount: 6,
      lastResponseStatus: 503,
      lastSafeError: "Service unavailable",
      attempts,
    }).success).toBe(true);
    expect(FailedDeliverySchema.safeParse({
      ...failedDelivery,
      attemptCount: 7,
      attempts: [
        ...attempts,
        {
          ...retryableAttempt,
          id: "00000000-0000-4000-8000-000000000007",
          attemptNumber: 7,
        },
      ],
    }).success).toBe(false);
  });

  it("enforces delivery response, safe message, deduplication, and replay bounds", () => {
    for (const lastResponseStatus of [100, 599]) {
      expect(FailedDeliverySchema.safeParse({
        ...failedDelivery,
        lastResponseStatus,
        attempts: [{ ...finalAttempt, responseStatus: lastResponseStatus }],
      }).success).toBe(true);
    }
    for (const lastResponseStatus of [99, 600, 100.5]) {
      expect(FailedDeliverySchema.safeParse({
        ...failedDelivery,
        lastResponseStatus,
      }).success).toBe(false);
    }
    expect(FailedDeliverySchema.safeParse({
      ...failedDelivery,
      lastSafeError: ` ${"e".repeat(500)} `,
      attempts: [{ ...finalAttempt, safeError: ` ${"e".repeat(500)} ` }],
    }).success).toBe(true);
    expect(FailedDeliverySchema.safeParse({
      ...failedDelivery,
      lastSafeError: "e".repeat(501),
    }).success).toBe(false);
    expect(QueuedDeliverySchema.safeParse({ ...queuedDelivery, deduplicationKey: "" }).success).toBe(
      false,
    );
    expect(QueuedDeliverySchema.safeParse({
      ...queuedDelivery,
      deduplicationKey: "d".repeat(512),
    }).success).toBe(true);
    expect(QueuedDeliverySchema.safeParse({
      ...queuedDelivery,
      deduplicationKey: "d".repeat(513),
    }).success).toBe(false);
    expect(QueuedDeliverySchema.safeParse({
      ...queuedDelivery,
      replayOfDeliveryId: "not-an-id",
    }).success).toBe(false);
  });

  it("rejects unknown delivery and nested attempt fields", () => {
    expect(NotificationDeliverySchema.safeParse({
      ...deliveredDelivery,
      payload: { secret: true },
    }).success).toBe(false);
    expect(NotificationDeliverySchema.safeParse({
      ...deliveredDelivery,
      attempts: [{ ...deliveredAttempt, internalError: "secret" }],
    }).success).toBe(false);
  });
});

describe("delivery attempt collection invariants", () => {
  const secondAttempt = {
    ...deliveredAttempt,
    id: secondAttemptId,
    attemptNumber: 2,
    startedAt: completedAt,
    completedAt: secondCompletedAt,
  } as const;
  const twoAttemptDelivery = {
    ...deliveredDelivery,
    attemptCount: 2,
    attempts: [retryableAttempt, secondAttempt],
    updatedAt: secondCompletedAt,
  } as const;

  it("accepts contiguous, uniquely identified, owned attempts with a matching count", () => {
    expect(DeliveredDeliverySchema.safeParse(twoAttemptDelivery).success).toBe(true);
  });

  it("requires every attempt number to equal its one-based index", () => {
    const result = DeliveredDeliverySchema.safeParse({
      ...twoAttemptDelivery,
      attempts: [retryableAttempt, { ...secondAttempt, attemptNumber: 3 }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) =>
        issue.path.join(".") === "attempts.1.attemptNumber" &&
          issue.message === "attemptNumber must equal its one-based index"
      )).toBe(true);
    }
  });

  it("rejects duplicate attempt numbers with a useful path", () => {
    const result = DeliveredDeliverySchema.safeParse({
      ...twoAttemptDelivery,
      attempts: [deliveredAttempt, { ...secondAttempt, attemptNumber: 1 }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) =>
        issue.path.join(".") === "attempts.1.attemptNumber" && issue.message.includes("unique")
      )).toBe(true);
    }
  });

  it("rejects duplicate UUIDs after canonical case normalization", () => {
    const result = DeliveredDeliverySchema.safeParse({
      ...twoAttemptDelivery,
      attempts: [deliveredAttempt, { ...secondAttempt, id: attemptId.toUpperCase() }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) =>
        issue.path.join(".") === "attempts.1.id" && issue.message.includes("unique")
      )).toBe(true);
    }
  });

  it("matches each attempt owner to the enclosing delivery case-insensitively", () => {
    expect(DeliveredDeliverySchema.safeParse({
      ...deliveredDelivery,
      id: deliveryId.toUpperCase(),
    }).success).toBe(true);
    const result = DeliveredDeliverySchema.safeParse({
      ...deliveredDelivery,
      attempts: [{ ...deliveredAttempt, deliveryId: channelId }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["attempts", 0, "deliveryId"]);
      expect(result.error.issues[0]?.message).toContain("enclosing delivery");
    }
  });

  it("requires attemptCount to equal attempts length with a useful path", () => {
    const result = DeliveredDeliverySchema.safeParse({
      ...twoAttemptDelivery,
      attemptCount: 1,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["attemptCount"]);
      expect(result.error.issues[0]?.message).toBe("attemptCount must equal attempts length");
    }
  });

  it("keeps inferred and parsed attempts readonly", () => {
    expectTypeOf<NotificationDelivery["attempts"]>().toEqualTypeOf<
      readonly NotificationAttempt[]
    >();
    const parsed = NotificationDeliverySchema.parse(deliveredDelivery);
    expect(Object.isFrozen(parsed.attempts)).toBe(true);
  });

  it("requires every retrying attempt to be retryable_failure", () => {
    for (const attempt of [deliveredAttempt, finalAttempt]) {
      const result = RetryingDeliverySchema.safeParse({
        ...retryingDelivery,
        lastResponseStatus: attempt.responseStatus,
        lastSafeError: attempt.safeError,
        attempts: [attempt],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((issue) =>
          issue.path.join(".") === "attempts.0.outcome" &&
            issue.message === "retrying attempts must be retryable_failure"
        )).toBe(true);
      }
    }
  });

  it("requires delivered histories to end once with delivered after only retryable failures", () => {
    expect(DeliveredDeliverySchema.safeParse(twoAttemptDelivery).success).toBe(true);
    for (const attempts of [
      [deliveredAttempt, secondAttempt],
      [finalAttempt, secondAttempt],
      [retryableAttempt, { ...secondAttempt, outcome: "retryable_failure", responseStatus: 503,
        safeError: "Service unavailable" }],
      [retryableAttempt, { ...secondAttempt, outcome: "final_failure", responseStatus: 500,
        safeError: "Rejected" }],
    ]) {
      const final = attempts[attempts.length - 1];
      expect(DeliveredDeliverySchema.safeParse({
        ...twoAttemptDelivery,
        lastResponseStatus: final?.responseStatus,
        lastSafeError: final?.safeError,
        attempts,
      }).success).toBe(false);
    }
  });

  it("allows failed histories to end in final_failure or exhaust six retryable failures", () => {
    const secondFinalAttempt = {
      ...finalAttempt,
      id: secondAttemptId,
      attemptNumber: 2,
      startedAt: completedAt,
      completedAt: secondCompletedAt,
    } as const;
    expect(FailedDeliverySchema.safeParse({
      ...failedDelivery,
      attemptCount: 2,
      attempts: [retryableAttempt, secondFinalAttempt],
      updatedAt: secondCompletedAt,
    }).success).toBe(true);

    const exhaustedAttempts = Array.from({ length: 6 }, (_, index) => ({
      ...retryableAttempt,
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      attemptNumber: index + 1,
      completedAt: startedAt,
    }));
    expect(FailedDeliverySchema.safeParse({
      ...failedDelivery,
      attemptCount: 6,
      lastResponseStatus: 503,
      lastSafeError: "Service unavailable",
      attempts: exhaustedAttempts,
    }).success).toBe(true);
  });

  it("rejects delivered outcomes and invalid terminal failure placement in failed histories", () => {
    const secondRetryableAttempt = {
      ...retryableAttempt,
      id: secondAttemptId,
      attemptNumber: 2,
      startedAt: completedAt,
      completedAt: secondCompletedAt,
    } as const;
    for (const value of [
      { ...failedDelivery, lastResponseStatus: 204, lastSafeError: null,
        attempts: [deliveredAttempt] },
      { ...failedDelivery, lastResponseStatus: 503, lastSafeError: "Service unavailable",
        attempts: [retryableAttempt] },
      { ...failedDelivery, attemptCount: 2, lastResponseStatus: 503,
        lastSafeError: "Service unavailable", attempts: [finalAttempt, secondRetryableAttempt] },
    ]) {
      expect(FailedDeliverySchema.safeParse(value).success).toBe(false);
    }
  });

  it("requires delivery last response fields to exactly match the final attempt", () => {
    for (const [schema, value] of [
      [RetryingDeliverySchema, retryingDelivery],
      [DeliveredDeliverySchema, deliveredDelivery],
      [FailedDeliverySchema, failedDelivery],
    ] as const) {
      const changes = [
        { lastResponseStatus: 500 },
        ...(value.status === "delivered" ? [] : [{ lastSafeError: "Mismatch" }]),
      ];
      for (const change of changes) {
        const result = schema.safeParse({ ...value, ...change });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues.some((issue) =>
            issue.message.includes("must equal final attempt")
          )).toBe(true);
        }
      }
    }
  });
});

describe("delivery temporal and replay integrity", () => {
  it("requires updatedAt at or after createdAt for every status", () => {
    for (const value of [queuedDelivery, retryingDelivery, deliveredDelivery, failedDelivery]) {
      const result = NotificationDeliverySchema.safeParse({
        ...value,
        createdAt: completedAt,
        updatedAt: startedAt,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((issue) =>
          issue.path.join(".") === "updatedAt" &&
            issue.message === "updatedAt must be greater than or equal to createdAt"
        )).toBe(true);
      }
    }
  });

  it("requires each attempt to start at or after delivery creation", () => {
    const result = DeliveredDeliverySchema.safeParse({
      ...deliveredDelivery,
      createdAt: completedAt,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) =>
        issue.path.join(".") === "attempts.0.startedAt" &&
          issue.message === "attempt startedAt must be greater than or equal to delivery createdAt"
      )).toBe(true);
    }
  });

  it("requires each later attempt to start at or after the previous completion", () => {
    const firstAttempt = { ...retryableAttempt, completedAt } as const;
    const finalAttemptWithOverlap = {
      ...deliveredAttempt,
      id: secondAttemptId,
      attemptNumber: 2,
      startedAt,
      completedAt,
    } as const;
    const result = DeliveredDeliverySchema.safeParse({
      ...deliveredDelivery,
      attemptCount: 2,
      attempts: [firstAttempt, finalAttemptWithOverlap],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) =>
        issue.path.join(".") === "attempts.1.startedAt" &&
          issue.message === "attempt startedAt must be greater than or equal to previous completedAt"
      )).toBe(true);
    }
  });

  it("requires updatedAt at or after the final attempt completion", () => {
    const result = DeliveredDeliverySchema.safeParse({
      ...deliveredDelivery,
      updatedAt: "2026-07-22T12:00:00.0005Z",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) =>
        issue.path.join(".") === "updatedAt" &&
          issue.message === "updatedAt must be greater than or equal to final attempt completedAt"
      )).toBe(true);
    }
  });

  it("requires retry scheduling at or after the final attempt completion", () => {
    const result = RetryingDeliverySchema.safeParse({
      ...retryingDelivery,
      nextAttemptAt: "2026-07-22T12:00:00.0005Z",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) =>
        issue.path.join(".") === "nextAttemptAt" &&
          issue.message === "nextAttemptAt must be greater than or equal to final attempt completedAt"
      )).toBe(true);
    }
  });

  it("rejects a replay that points to the same delivery UUID in any case", () => {
    const result = QueuedDeliverySchema.safeParse({
      ...queuedDelivery,
      replayOfDeliveryId: deliveryId.toUpperCase(),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) =>
        issue.path.join(".") === "replayOfDeliveryId" &&
          issue.message === "replayOfDeliveryId must differ from delivery id"
      )).toBe(true);
    }
  });

  it("compares arbitrary fractional precision and offset-equivalent timestamps", () => {
    expect(DeliveredDeliverySchema.safeParse({
      ...deliveredDelivery,
      createdAt: "2026-07-22T13:00:00.0001+01:00",
      attempts: [{
        ...deliveredAttempt,
        startedAt: "2026-07-22T12:00:00.0001Z",
        completedAt: "2026-07-22T12:00:00.0001001Z",
      }],
      updatedAt: "2026-07-22T13:00:00.0001001+01:00",
    }).success).toBe(true);
    expect(DeliveredDeliverySchema.safeParse({
      ...deliveredDelivery,
      attempts: [{
        ...deliveredAttempt,
        completedAt: "2026-07-22T12:00:00.0001001Z",
      }],
      updatedAt: "2026-07-22T12:00:00.0001000Z",
    }).success).toBe(false);
  });
});

describe("delivery list and replay contracts", () => {
  it("inherits page defaults and accepts all filters", () => {
    expect(DeliveryListQuerySchema.parse({})).toEqual({ limit: 25 });
    expect(DeliveryListQuerySchema.parse({
      cursor: "next",
      limit: "100",
      status: "failed",
      monitorId,
      channelId,
      from: startedAt,
      to: completedAt,
    })).toEqual({
      cursor: "next",
      limit: 100,
      status: "failed",
      monitorId,
      channelId,
      from: startedAt,
      to: completedAt,
    });
    for (const limit of [1, 25, 100]) {
      expect(DeliveryListQuerySchema.safeParse({ limit }).success).toBe(true);
    }
    expect(DeliveryListQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
  });

  it("rejects malformed filters and unknown query fields", () => {
    for (const query of [
      { status: "pending" },
      { monitorId: "not-an-id" },
      { channelId: "not-an-id" },
      { from: "not-a-time" },
      { extra: true },
    ]) {
      expect(DeliveryListQuerySchema.safeParse(query).success).toBe(false);
    }
  });

  it("orders query ranges beyond milliseconds and across offsets", () => {
    const reversed = DeliveryListQuerySchema.safeParse({ from: completedAt, to: startedAt });
    expect(reversed.success).toBe(false);
    if (!reversed.success) {
      expect(reversed.error.issues[0]?.path).toEqual(["to"]);
      expect(reversed.error.issues[0]?.message).toBe("to must be greater than or equal to from");
    }
    expect(DeliveryListQuerySchema.safeParse({
      from: "2026-07-22T13:00:00.0001+01:00",
      to: "2026-07-22T12:00:00.0001Z",
    }).success).toBe(true);
  });

  it("accepts at most 100 list items and preserves immutable embedded attempts", () => {
    const response = {
      items: Array.from({ length: 100 }, () => deliveredDelivery),
      page: { nextCursor: null, hasMore: false },
    };
    const parsed = DeliveryListResponseSchema.parse(response);
    expect(parsed.items).toHaveLength(100);
    expect(Object.isFrozen(parsed.items[0]?.attempts)).toBe(true);
    expect(DeliveryListResponseSchema.safeParse({
      ...response,
      items: [...response.items, deliveredDelivery],
    }).success).toBe(false);
    expect(DeliveryListResponseSchema.safeParse({ ...response, extra: true }).success).toBe(false);
    expect(DeliveryListResponseSchema.safeParse({
      ...response,
      page: { ...response.page, extra: true },
    }).success).toBe(false);
  });

  it("accepts only an exact confirmed replay command", () => {
    expect(ReplayDeliverySchema.parse({ confirmed: true })).toEqual({ confirmed: true });
    expect(ReplayDeliverySchema.safeParse({ confirmed: false }).success).toBe(false);
    expect(ReplayDeliverySchema.safeParse({ confirmed: true, deliveryId }).success).toBe(false);
  });
});
