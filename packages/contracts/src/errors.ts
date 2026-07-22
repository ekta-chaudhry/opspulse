import { CorrelationIdSchema, SafeMessageSchema } from "./common.js";
import { z } from "./zod.js";

export const ApiErrorCodeSchema = z.enum([
  "invalid_request",
  "authentication_failed",
  "unauthenticated",
  "csrf_invalid",
  "forbidden",
  "not_found",
  "conflict",
  "rate_limited",
  "internal_error",
  "dependency_unavailable",
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorDetailSchema = z.strictObject({
  field: z.string().trim().min(1).max(128).nullable(),
  issue: SafeMessageSchema,
});
export type ApiErrorDetail = z.infer<typeof ApiErrorDetailSchema>;

export const ApiErrorSchema = z.strictObject({
  error: z.strictObject({
    code: ApiErrorCodeSchema,
    message: SafeMessageSchema,
    correlationId: CorrelationIdSchema,
    details: z.array(ApiErrorDetailSchema),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const API_ERROR_STATUS = {
  invalid_request: 400,
  authentication_failed: 401,
  unauthenticated: 401,
  csrf_invalid: 403,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  internal_error: 500,
  dependency_unavailable: 503,
} as const satisfies Record<ApiErrorCode, number>;

export type ApiErrorStatus = (typeof API_ERROR_STATUS)[ApiErrorCode];
