import { SafeMessageSchema } from "./common.js";
import { z } from "./zod.js";

export const FailureCategorySchema = z.enum([
  "http_status",
  "timeout",
  "dns",
  "connection",
  "tls",
  "network",
  "heartbeat_late",
  "unknown",
]);
export type FailureCategory = z.infer<typeof FailureCategorySchema>;

export const FailureCauseSchema = z
  .strictObject({
    category: FailureCategorySchema,
    code: z.string().regex(/^[A-Z0-9_-]{1,64}$/).nullable(),
    httpStatus: z.number().int().min(100).max(599).nullable(),
    safeSummary: SafeMessageSchema,
  })
  .superRefine((cause, context) => {
    const statusMatchesCategory =
      cause.category === "http_status" ? cause.httpStatus !== null : cause.httpStatus === null;
    if (!statusMatchesCategory) {
      context.addIssue({
        code: "custom",
        message: "HTTP status must be set only for http_status failures",
        path: ["httpStatus"],
      });
    }
  });
export type FailureCause = z.infer<typeof FailureCauseSchema>;
