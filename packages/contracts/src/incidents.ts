import {
  CursorPageInfoSchema,
  CursorQuerySchema,
  IdSchema,
  TimestampSchema,
} from "./common.js";
import { FailureCauseSchema } from "./failure-causes.js";
import { isTimestampAtOrAfter } from "./timestamp-order.js";
import { z } from "./zod.js";

export const IncidentStatusSchema = z.enum(["open", "resolved"]);
export type IncidentStatus = z.infer<typeof IncidentStatusSchema>;

export const ResolutionReasonSchema = z.enum(["recovered", "monitor_archived"]);
export type ResolutionReason = z.infer<typeof ResolutionReasonSchema>;

const incidentShape = {
  id: IdSchema,
  monitorId: IdSchema,
  monitorName: z.string().trim().min(1).max(100),
  startedAt: TimestampSchema,
  openingCause: FailureCauseSchema,
  latestCause: FailureCauseSchema,
};

const OpenIncidentSchema = z.strictObject({
  ...incidentShape,
  status: z.literal("open"),
  resolvedAt: z.null(),
  resolutionReason: z.null(),
});

const ResolvedIncidentSchema = z
  .strictObject({
    ...incidentShape,
    status: z.literal("resolved"),
    resolvedAt: TimestampSchema,
    resolutionReason: ResolutionReasonSchema,
  })
  .refine(({ startedAt, resolvedAt }) => isTimestampAtOrAfter(resolvedAt, startedAt), {
    path: ["resolvedAt"],
    message: "resolvedAt must be greater than or equal to startedAt",
  });

export const IncidentSchema = z.discriminatedUnion("status", [
  OpenIncidentSchema,
  ResolvedIncidentSchema,
]);
export type Incident = z.infer<typeof IncidentSchema>;

export const IncidentListQuerySchema = CursorQuerySchema.extend({
  monitorId: IdSchema.optional(),
  status: IncidentStatusSchema.optional(),
  from: TimestampSchema.optional(),
  to: TimestampSchema.optional(),
}).refine(
  ({ from, to }) => from === undefined || to === undefined || isTimestampAtOrAfter(to, from),
  {
    path: ["to"],
    message: "to must be greater than or equal to from",
  },
);
export type IncidentListQuery = z.infer<typeof IncidentListQuerySchema>;

export const IncidentListResponseSchema = z.strictObject({
  items: z.array(IncidentSchema),
  page: CursorPageInfoSchema,
});
export type IncidentListResponse = z.infer<typeof IncidentListResponseSchema>;
