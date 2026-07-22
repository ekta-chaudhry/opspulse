import {
  CursorPageInfoSchema,
  CursorQuerySchema,
  IdSchema,
  SafeMessageSchema,
  TimestampSchema,
} from "./common.js";
import { isTimestampAtOrAfter } from "./timestamp-order.js";
import { z } from "./zod.js";

export const DeliveryStatusSchema = z.enum(["queued", "retrying", "delivered", "failed"]);
export type DeliveryStatus = z.infer<typeof DeliveryStatusSchema>;

export const AttemptOutcomeSchema = z.enum([
  "delivered",
  "retryable_failure",
  "final_failure",
]);
export type AttemptOutcome = z.infer<typeof AttemptOutcomeSchema>;

const ResponseStatusSchema = z.number().int().min(100).max(599);
const AttemptNumberSchema = z.number().int().min(1).max(6);
const attemptShape = {
  id: IdSchema,
  deliveryId: IdSchema,
  attemptNumber: AttemptNumberSchema,
  startedAt: TimestampSchema,
  completedAt: TimestampSchema,
};
const AttemptChronologyRefinement = {
  path: ["completedAt"],
  message: "completedAt must be greater than or equal to startedAt",
};

const DeliveredAttemptSchema = z
  .strictObject({
    ...attemptShape,
    outcome: z.literal("delivered"),
    responseStatus: z.number().int().min(200).max(299),
    safeError: z.null(),
  })
  .refine(
    ({ startedAt, completedAt }) => isTimestampAtOrAfter(completedAt, startedAt),
    AttemptChronologyRefinement,
  );

function hasFailureDetail(attempt: {
  responseStatus: number | null;
  safeError: string | null;
}): boolean {
  return attempt.responseStatus !== null || attempt.safeError !== null;
}

function hasLastFailureDetail(delivery: {
  lastResponseStatus: number | null;
  lastSafeError: string | null;
}): boolean {
  return delivery.lastResponseStatus !== null || delivery.lastSafeError !== null;
}

const RetryableFailureAttemptSchema = z
  .strictObject({
    ...attemptShape,
    outcome: z.literal("retryable_failure"),
    responseStatus: ResponseStatusSchema.nullable(),
    safeError: SafeMessageSchema.nullable(),
  })
  .refine(hasFailureDetail, {
    path: ["safeError"],
    message: "a failure response status or safe error is required",
  })
  .refine(
    ({ startedAt, completedAt }) => isTimestampAtOrAfter(completedAt, startedAt),
    AttemptChronologyRefinement,
  );

const FinalFailureAttemptSchema = z
  .strictObject({
    ...attemptShape,
    outcome: z.literal("final_failure"),
    responseStatus: ResponseStatusSchema.nullable(),
    safeError: SafeMessageSchema.nullable(),
  })
  .refine(hasFailureDetail, {
    path: ["safeError"],
    message: "a failure response status or safe error is required",
  })
  .refine(
    ({ startedAt, completedAt }) => isTimestampAtOrAfter(completedAt, startedAt),
    AttemptChronologyRefinement,
  );

export const NotificationAttemptSchema = z.discriminatedUnion("outcome", [
  DeliveredAttemptSchema,
  RetryableFailureAttemptSchema,
  FinalFailureAttemptSchema,
]);
export type NotificationAttempt = z.infer<typeof NotificationAttemptSchema>;

const AttemptsSchema = z.array(NotificationAttemptSchema).max(6).readonly();
const DeduplicationKeySchema = z.string().min(1).max(512);
const DeliveryAttemptCountSchema = z.number().int().min(0).max(6);
const deliveryShape = {
  id: IdSchema,
  incidentEventId: IdSchema,
  channelId: IdSchema,
  deduplicationKey: DeduplicationKeySchema,
  replayOfDeliveryId: IdSchema.nullable(),
  attemptCount: DeliveryAttemptCountSchema,
  lastResponseStatus: ResponseStatusSchema.nullable(),
  lastSafeError: SafeMessageSchema.nullable(),
  nextAttemptAt: TimestampSchema.nullable(),
  attempts: AttemptsSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
};

interface DeliveryAttemptCollection {
  id: string;
  attemptCount: number;
  attempts: readonly {
    id: string;
    deliveryId: string;
    attemptNumber: number;
  }[];
}

interface DeliveryAttemptIssue {
  path: PropertyKey[];
  message: string;
}

function deliveryAttemptIssues(delivery: DeliveryAttemptCollection): DeliveryAttemptIssue[] {
  const issues: DeliveryAttemptIssue[] = [];
  if (delivery.attemptCount !== delivery.attempts.length) {
    issues.push({ path: ["attemptCount"], message: "attemptCount must equal attempts length" });
  }

  const attemptIds = new Set<string>();
  const attemptNumbers = new Set<number>();
  for (const [index, attempt] of delivery.attempts.entries()) {
    if (attempt.deliveryId.toLowerCase() !== delivery.id.toLowerCase()) {
      issues.push({
        path: ["attempts", index, "deliveryId"],
        message: "attempt deliveryId must match enclosing delivery id",
      });
    }

    const canonicalAttemptId = attempt.id.toLowerCase();
    if (attemptIds.has(canonicalAttemptId)) {
      issues.push({
        path: ["attempts", index, "id"],
        message: "attempt ids must be unique",
      });
    }
    attemptIds.add(canonicalAttemptId);

    if (attemptNumbers.has(attempt.attemptNumber)) {
      issues.push({
        path: ["attempts", index, "attemptNumber"],
        message: "attempt numbers must be unique",
      });
    }
    attemptNumbers.add(attempt.attemptNumber);

    const previousAttempt = delivery.attempts[index - 1];
    if (previousAttempt !== undefined && attempt.attemptNumber <= previousAttempt.attemptNumber) {
      issues.push({
        path: ["attempts", index, "attemptNumber"],
        message: "attempt numbers must be sorted ascending",
      });
    }
  }
  return issues;
}

function addDeliveryAttemptIssues(
  delivery: DeliveryAttemptCollection,
  addIssue: (issue: { code: "custom"; path: PropertyKey[]; message: string }) => void,
): void {
  for (const issue of deliveryAttemptIssues(delivery)) {
    addIssue({ code: "custom", ...issue });
  }
}

export const QueuedDeliverySchema = z
  .strictObject({
    ...deliveryShape,
    status: z.literal("queued"),
    attemptCount: z.literal(0),
    lastResponseStatus: z.null(),
    lastSafeError: z.null(),
    nextAttemptAt: TimestampSchema,
  })
  .superRefine((delivery, context) => {
    addDeliveryAttemptIssues(delivery, (issue) => {
      context.addIssue(issue);
    });
  });
export type QueuedDelivery = z.infer<typeof QueuedDeliverySchema>;

export const RetryingDeliverySchema = z
  .strictObject({
    ...deliveryShape,
    status: z.literal("retrying"),
    attemptCount: z.number().int().min(1).max(5),
    nextAttemptAt: TimestampSchema,
  })
  .refine(hasLastFailureDetail, {
    path: ["lastSafeError"],
    message: "a last response status or safe error is required",
  })
  .superRefine((delivery, context) => {
    addDeliveryAttemptIssues(delivery, (issue) => {
      context.addIssue(issue);
    });
  });
export type RetryingDelivery = z.infer<typeof RetryingDeliverySchema>;

export const DeliveredDeliverySchema = z
  .strictObject({
    ...deliveryShape,
    status: z.literal("delivered"),
    attemptCount: z.number().int().min(1).max(6),
    lastResponseStatus: z.number().int().min(200).max(299),
    lastSafeError: z.null(),
    nextAttemptAt: z.null(),
  })
  .superRefine((delivery, context) => {
    addDeliveryAttemptIssues(delivery, (issue) => {
      context.addIssue(issue);
    });
  });
export type DeliveredDelivery = z.infer<typeof DeliveredDeliverySchema>;

export const FailedDeliverySchema = z
  .strictObject({
    ...deliveryShape,
    status: z.literal("failed"),
    attemptCount: z.number().int().min(1).max(6),
    nextAttemptAt: z.null(),
  })
  .refine(hasLastFailureDetail, {
    path: ["lastSafeError"],
    message: "a last response status or safe error is required",
  })
  .superRefine((delivery, context) => {
    addDeliveryAttemptIssues(delivery, (issue) => {
      context.addIssue(issue);
    });
  });
export type FailedDelivery = z.infer<typeof FailedDeliverySchema>;

export const NotificationDeliverySchema = z.discriminatedUnion("status", [
  QueuedDeliverySchema,
  RetryingDeliverySchema,
  DeliveredDeliverySchema,
  FailedDeliverySchema,
]);
export type NotificationDelivery = z.infer<typeof NotificationDeliverySchema>;

export const DeliveryListQuerySchema = CursorQuerySchema.extend({
  status: DeliveryStatusSchema.optional(),
  monitorId: IdSchema.optional(),
  channelId: IdSchema.optional(),
  from: TimestampSchema.optional(),
  to: TimestampSchema.optional(),
}).refine(
  ({ from, to }) => from === undefined || to === undefined || isTimestampAtOrAfter(to, from),
  {
    path: ["to"],
    message: "to must be greater than or equal to from",
  },
);
export type DeliveryListQuery = z.infer<typeof DeliveryListQuerySchema>;

export const DeliveryListResponseSchema = z.strictObject({
  items: z.array(NotificationDeliverySchema).max(100),
  page: CursorPageInfoSchema,
});
export type DeliveryListResponse = z.infer<typeof DeliveryListResponseSchema>;

export const ReplayDeliverySchema = z.strictObject({
  confirmed: z.literal(true),
});
export type ReplayDelivery = z.infer<typeof ReplayDeliverySchema>;
