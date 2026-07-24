import {
  CursorPageInfoSchema,
  CursorQuerySchema,
  IdSchema,
  SafeMessageSchema,
  TimestampSchema,
} from "./common.js";
import { FailureCauseSchema } from "./failure-causes.js";
import { isTimestampAtOrAfter } from "./timestamp-order.js";
import { z } from "./zod.js";

export const CheckRequestSourceSchema = z.enum([
  "http_schedule",
  "heartbeat_ping",
  "heartbeat_deadline",
]);
export type CheckRequestSource = z.infer<typeof CheckRequestSourceSchema>;

export const CheckRequestStatusSchema = z.enum([
  "pending",
  "completed",
  "cancelled-internal",
]);
export type CheckRequestStatus = z.infer<typeof CheckRequestStatusSchema>;

export const CheckResultSchema = z.enum(["success", "failure", "timeout"]);
export type CheckResult = z.infer<typeof CheckResultSchema>;

const NonnegativeSafeIntegerSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const PositiveSafeIntegerSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);

const checkRequestShape = {
  id: IdSchema,
  monitorId: IdSchema,
  generation: NonnegativeSafeIntegerSchema,
  sequence: PositiveSafeIntegerSchema,
  source: CheckRequestSourceSchema,
  scheduledAt: TimestampSchema,
  createdAt: TimestampSchema,
};

const PendingCheckRequestSchema = z.strictObject({
  ...checkRequestShape,
  status: z.literal("pending"),
  terminalAt: z.null(),
});

function hasOrderedTerminalTimestamp(request: {
  createdAt: string;
  terminalAt: string;
}): boolean {
  return isTimestampAtOrAfter(request.terminalAt, request.createdAt);
}

const TerminalTimestampRefinement = {
  path: ["terminalAt"],
  message: "terminalAt must be greater than or equal to createdAt",
};

const CompletedCheckRequestSchema = z
  .strictObject({
    ...checkRequestShape,
    status: z.literal("completed"),
    terminalAt: TimestampSchema,
  })
  .refine(hasOrderedTerminalTimestamp, TerminalTimestampRefinement);

const CancelledCheckRequestSchema = z
  .strictObject({
    ...checkRequestShape,
    status: z.literal("cancelled-internal"),
    terminalAt: TimestampSchema,
  })
  .refine(hasOrderedTerminalTimestamp, TerminalTimestampRefinement);

export const CheckRequestSchema = z.discriminatedUnion("status", [
  PendingCheckRequestSchema,
  CompletedCheckRequestSchema,
  CancelledCheckRequestSchema,
]);
export type CheckRequest = z.infer<typeof CheckRequestSchema>;

export const CheckRunSchema = z
  .strictObject({
    id: IdSchema,
    checkRequestId: IdSchema.nullable(),
    monitorId: IdSchema,
    generation: NonnegativeSafeIntegerSchema,
    sequence: PositiveSafeIntegerSchema,
    result: CheckResultSchema,
    httpStatus: z.number().int().min(100).max(599).nullable(),
    latencyMs: NonnegativeSafeIntegerSchema.nullable(),
    cause: FailureCauseSchema.nullable(),
    completedAt: TimestampSchema,
    createdAt: TimestampSchema,
    evaluatedAt: TimestampSchema.nullable(),
  })
  .superRefine((run, context) => {
    if (
      run.evaluatedAt !== null &&
      !isTimestampAtOrAfter(run.evaluatedAt, run.completedAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["evaluatedAt"],
        message: "evaluatedAt must be greater than or equal to completedAt",
      });
    }
    if (run.result === "success" && run.cause !== null) {
      context.addIssue({
        code: "custom",
        path: ["cause"],
        message: "cause must be null for successful checks",
      });
    }
    if (run.result !== "success" && run.cause === null) {
      context.addIssue({
        code: "custom",
        path: ["cause"],
        message: "cause is required for failed and timed out checks",
      });
    }
    if (
      run.cause?.category === "http_status" &&
      run.httpStatus !== run.cause.httpStatus
    ) {
      context.addIssue({
        code: "custom",
        path: ["httpStatus"],
        message: "httpStatus must match cause.httpStatus for http_status failures",
      });
    }
  });
export type CheckRun = z.infer<typeof CheckRunSchema>;

export const MonitoringErrorSchema = z.strictObject({
  safeSummary: SafeMessageSchema,
  recordedAt: TimestampSchema,
});
export type MonitoringError = z.infer<typeof MonitoringErrorSchema>;

export const PendingCheckHistoryItemSchema = z.strictObject({
  request: PendingCheckRequestSchema,
  run: z.null(),
  monitoringError: z.null(),
});
export type PendingCheckHistoryItem = z.infer<typeof PendingCheckHistoryItemSchema>;

export const CompletedCheckHistoryItemSchema = z
  .strictObject({
    request: CompletedCheckRequestSchema,
    run: CheckRunSchema,
    monitoringError: z.null(),
  })
  .superRefine(({ request, run }, context) => {
    if (run.checkRequestId === null) {
      context.addIssue({
        code: "custom",
        path: ["run", "checkRequestId"],
        message: "run.checkRequestId must not be null",
      });
    } else if (run.checkRequestId !== request.id) {
      context.addIssue({
        code: "custom",
        path: ["run", "checkRequestId"],
        message: "run.checkRequestId must match request.id",
      });
    }
    if (run.monitorId !== request.monitorId) {
      context.addIssue({
        code: "custom",
        path: ["run", "monitorId"],
        message: "run.monitorId must match request.monitorId",
      });
    }
    if (run.generation !== request.generation) {
      context.addIssue({
        code: "custom",
        path: ["run", "generation"],
        message: "run.generation must match request.generation",
      });
    }
    if (run.sequence !== request.sequence) {
      context.addIssue({
        code: "custom",
        path: ["run", "sequence"],
        message: "run.sequence must match request.sequence",
      });
    }
  });
export type CompletedCheckHistoryItem = z.infer<typeof CompletedCheckHistoryItemSchema>;

export const CancelledCheckHistoryItemSchema = z.strictObject({
  request: CancelledCheckRequestSchema,
  run: z.null(),
  monitoringError: MonitoringErrorSchema,
});
export type CancelledCheckHistoryItem = z.infer<typeof CancelledCheckHistoryItemSchema>;

export const CheckHistoryItemSchema = z.union([
  PendingCheckHistoryItemSchema,
  CompletedCheckHistoryItemSchema,
  CancelledCheckHistoryItemSchema,
]);
export type CheckHistoryItem = z.infer<typeof CheckHistoryItemSchema>;

export const CheckListQuerySchema = CursorQuerySchema.extend({
  result: CheckResultSchema.optional(),
  from: TimestampSchema.optional(),
  to: TimestampSchema.optional(),
}).refine(
  ({ from, to }) => from === undefined || to === undefined || isTimestampAtOrAfter(to, from),
  {
    path: ["to"],
    message: "to must be greater than or equal to from",
  },
);
export type CheckListQuery = z.infer<typeof CheckListQuerySchema>;

export const CheckListResponseSchema = z.strictObject({
  items: z.array(CheckHistoryItemSchema),
  page: CursorPageInfoSchema,
});
export type CheckListResponse = z.infer<typeof CheckListResponseSchema>;
