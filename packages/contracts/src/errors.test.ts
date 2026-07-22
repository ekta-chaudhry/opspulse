import { describe, expect, expectTypeOf, it } from "vitest";
import {
  API_ERROR_STATUS,
  ApiErrorCodeSchema,
  ApiErrorDetailSchema,
  ApiErrorSchema,
  type ApiErrorStatus,
} from "./errors.js";

const correlationId = "request-123";

describe("API error contracts", () => {
  it("defines every API error code and HTTP status mapping", () => {
    const expected = {
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
    } as const;

    expect(API_ERROR_STATUS).toEqual(expected);
    for (const code of Object.keys(expected)) {
      expect(ApiErrorCodeSchema.safeParse(code).success).toBe(true);
    }
    expect(ApiErrorCodeSchema.safeParse("unknown_error").success).toBe(false);
    expectTypeOf<ApiErrorStatus>().toEqualTypeOf<400 | 401 | 403 | 404 | 409 | 429 | 500 | 503>();
  });

  it("validates and normalizes error details", () => {
    expect(ApiErrorDetailSchema.parse({ field: "  email  ", issue: "  is invalid  " })).toEqual({
      field: "email",
      issue: "is invalid",
    });
    expect(ApiErrorDetailSchema.parse({ field: null, issue: "Request is invalid" })).toEqual({
      field: null,
      issue: "Request is invalid",
    });
  });

  it("enforces error detail field and issue bounds", () => {
    expect(ApiErrorDetailSchema.safeParse({ field: " ", issue: "Invalid" }).success).toBe(false);
    expect(
      ApiErrorDetailSchema.safeParse({ field: "x".repeat(129), issue: "Invalid" }).success,
    ).toBe(false);
    expect(ApiErrorDetailSchema.safeParse({ field: null, issue: " " }).success).toBe(false);
    expect(
      ApiErrorDetailSchema.safeParse({ field: null, issue: "x".repeat(501) }).success,
    ).toBe(false);
  });

  it("parses an exact nested API error envelope", () => {
    const value = {
      error: {
        code: "invalid_request",
        message: "Invalid request",
        correlationId,
        details: [{ field: "email", issue: "Email is invalid" }],
      },
    };

    expect(ApiErrorSchema.parse(value)).toEqual(value);
  });

  it("requires details to be present while allowing an empty array", () => {
    expect(
      ApiErrorSchema.safeParse({
        error: {
          code: "not_found",
          message: "Not found",
          correlationId,
          details: [],
        },
      }).success,
    ).toBe(true);
    expect(
      ApiErrorSchema.safeParse({
        error: { code: "not_found", message: "Not found", correlationId },
      }).success,
    ).toBe(false);
  });

  it("rejects unknown keys at every error envelope level", () => {
    expect(
      ApiErrorSchema.safeParse({
        error: {
          code: "internal_error",
          message: "Internal error",
          correlationId,
          details: [],
        },
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      ApiErrorSchema.safeParse({
        error: {
          code: "internal_error",
          message: "Internal error",
          correlationId,
          details: [],
          extra: true,
        },
      }).success,
    ).toBe(false);
    expect(
      ApiErrorSchema.safeParse({
        error: {
          code: "invalid_request",
          message: "Invalid request",
          correlationId,
          details: [{ field: null, issue: "Invalid", extra: true }],
        },
      }).success,
    ).toBe(false);
  });
});
