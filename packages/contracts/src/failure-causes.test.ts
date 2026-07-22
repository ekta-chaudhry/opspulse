import { describe, expect, it } from "vitest";
import { FailureCauseSchema, FailureCategorySchema } from "./failure-causes.js";

const validCause = {
  category: "timeout",
  code: "ETIMEDOUT",
  httpStatus: null,
  safeSummary: "Request timed out",
} as const;

describe("failure cause contracts", () => {
  it("accepts the http_status category", () => {
    expect(
      FailureCauseSchema.safeParse({ ...validCause, category: "http_status", httpStatus: 503 }).success,
    ).toBe(true);
  });

  it("accepts the timeout category", () => {
    expect(FailureCauseSchema.safeParse(validCause).success).toBe(true);
  });

  it("accepts the dns category", () => {
    expect(FailureCauseSchema.safeParse({ ...validCause, category: "dns" }).success).toBe(true);
  });

  it("accepts the connection category", () => {
    expect(FailureCauseSchema.safeParse({ ...validCause, category: "connection" }).success).toBe(
      true,
    );
  });

  it("accepts the tls category", () => {
    expect(FailureCauseSchema.safeParse({ ...validCause, category: "tls" }).success).toBe(true);
  });

  it("accepts the network category", () => {
    expect(FailureCauseSchema.safeParse({ ...validCause, category: "network" }).success).toBe(true);
  });

  it("accepts the heartbeat_late category", () => {
    expect(FailureCauseSchema.safeParse({ ...validCause, category: "heartbeat_late" }).success).toBe(
      true,
    );
  });

  it("accepts the unknown category and rejects unrecognized categories", () => {
    expect(FailureCauseSchema.safeParse({ ...validCause, category: "unknown" }).success).toBe(true);
    expect(FailureCategorySchema.safeParse("application").success).toBe(false);
  });

  it("accepts a null failure code", () => {
    expect(FailureCauseSchema.safeParse({ ...validCause, code: null }).success).toBe(true);
  });

  it("accepts a one-character failure code", () => {
    expect(FailureCauseSchema.safeParse({ ...validCause, code: "A" }).success).toBe(true);
  });

  it("accepts a 64-character failure code", () => {
    expect(FailureCauseSchema.safeParse({ ...validCause, code: "A".repeat(64) }).success).toBe(true);
  });

  it("rejects an empty failure code", () => {
    expect(FailureCauseSchema.safeParse({ ...validCause, code: "" }).success).toBe(false);
  });

  it("rejects lowercase and punctuated failure codes", () => {
    expect(FailureCauseSchema.safeParse({ ...validCause, code: "timeout" }).success).toBe(false);
    expect(FailureCauseSchema.safeParse({ ...validCause, code: "TIME.OUT" }).success).toBe(false);
  });

  it("rejects a failure code longer than 64 characters", () => {
    expect(FailureCauseSchema.safeParse({ ...validCause, code: "A".repeat(65) }).success).toBe(false);
  });

  it("requires an HTTP status for the http_status category", () => {
    expect(
      FailureCauseSchema.safeParse({ ...validCause, category: "http_status", httpStatus: null }).success,
    ).toBe(false);
  });

  it("requires a null HTTP status for non-http categories", () => {
    expect(FailureCauseSchema.safeParse({ ...validCause, httpStatus: 500 }).success).toBe(false);
  });

  it("rejects HTTP status 99", () => {
    expect(
      FailureCauseSchema.safeParse({ ...validCause, category: "http_status", httpStatus: 99 }).success,
    ).toBe(false);
  });

  it("accepts HTTP status 100", () => {
    expect(
      FailureCauseSchema.safeParse({ ...validCause, category: "http_status", httpStatus: 100 }).success,
    ).toBe(true);
  });

  it("accepts HTTP status 599", () => {
    expect(
      FailureCauseSchema.safeParse({ ...validCause, category: "http_status", httpStatus: 599 }).success,
    ).toBe(true);
  });

  it("rejects HTTP status 600", () => {
    expect(
      FailureCauseSchema.safeParse({ ...validCause, category: "http_status", httpStatus: 600 }).success,
    ).toBe(false);
  });

  it("rejects an empty safe summary", () => {
    expect(FailureCauseSchema.safeParse({ ...validCause, safeSummary: "" }).success).toBe(false);
  });

  it("accepts a 500-character safe summary", () => {
    expect(FailureCauseSchema.safeParse({ ...validCause, safeSummary: "x".repeat(500) }).success).toBe(
      true,
    );
  });

  it("rejects a safe summary longer than 500 characters", () => {
    expect(FailureCauseSchema.safeParse({ ...validCause, safeSummary: "x".repeat(501) }).success).toBe(
      false,
    );
  });

  it("rejects unknown failure cause keys", () => {
    expect(FailureCauseSchema.safeParse({ ...validCause, internalMessage: "secret" }).success).toBe(
      false,
    );
  });
});
