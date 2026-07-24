import { IdSchema, TimestampSchema } from "./common.js";
import { FailureCauseSchema } from "./failure-causes.js";
import { z } from "./zod.js";

export const IncidentSummarySchema = z.strictObject({
  id: IdSchema,
  status: z.literal("open"),
  startedAt: TimestampSchema,
  latestCause: FailureCauseSchema,
});
export type IncidentSummary = z.infer<typeof IncidentSummarySchema>;
