import { describe, expect, it } from "vitest";
import {
  HeartbeatAcceptedSchema,
  HeartbeatHeadersSchema,
  HeartbeatTokenParamsSchema,
} from "./heartbeats.js";

const token = "a".repeat(43);
const checkId = "550e8400-e29b-41d4-a716-446655440000";
const receivedAt = "2026-07-22T12:34:56Z";

describe("heartbeat token parameters", () => {
  it("rejects a 42-character token", () => {
    expect(HeartbeatTokenParamsSchema.safeParse({ token: "a".repeat(42) }).success).toBe(false);
  });

  it("accepts a 43-character token", () => {
    expect(HeartbeatTokenParamsSchema.parse({ token })).toEqual({ token });
  });

  it("accepts a 128-character token", () => {
    const maximumToken = "a".repeat(128);
    expect(HeartbeatTokenParamsSchema.parse({ token: maximumToken })).toEqual({
      token: maximumToken,
    });
  });

  it("rejects a 129-character token", () => {
    expect(HeartbeatTokenParamsSchema.safeParse({ token: "a".repeat(129) }).success).toBe(false);
  });

  it("accepts the full base64url alphabet", () => {
    const alphabetToken = `${"A".repeat(20)}${"z".repeat(20)}0_-`;
    expect(HeartbeatTokenParamsSchema.safeParse({ token: alphabetToken }).success).toBe(true);
  });

  it("rejects non-base64url characters and unknown keys", () => {
    expect(HeartbeatTokenParamsSchema.safeParse({ token: `${"a".repeat(42)}+` }).success).toBe(
      false,
    );
    expect(HeartbeatTokenParamsSchema.safeParse({ token, extra: true }).success).toBe(false);
  });
});

describe("heartbeat headers", () => {
  it("accepts an omitted idempotency key", () => {
    expect(HeartbeatHeadersSchema.parse({})).toEqual({});
  });

  it("rejects an empty normalized key", () => {
    expect(HeartbeatHeadersSchema.safeParse({ "idempotency-key": "   " }).success).toBe(false);
  });

  it("accepts a one-character normalized key", () => {
    expect(HeartbeatHeadersSchema.parse({ "idempotency-key": "a" })).toEqual({
      "idempotency-key": "a",
    });
  });

  it("accepts a 255-character normalized key", () => {
    const key = "a".repeat(255);
    expect(HeartbeatHeadersSchema.parse({ "idempotency-key": key })).toEqual({
      "idempotency-key": key,
    });
  });

  it("rejects a 256-character normalized key", () => {
    expect(HeartbeatHeadersSchema.safeParse({
      "idempotency-key": "a".repeat(256),
    }).success).toBe(false);
  });

  it("trims and preserves the normalized key output", () => {
    expect(HeartbeatHeadersSchema.parse({ "idempotency-key": "  request-123  " })).toEqual({
      "idempotency-key": "request-123",
    });
  });

  it("rejects every embedded ASCII C0 control and DEL after trimming", () => {
    const controlCodePoints = [
      ...Array.from({ length: 32 }, (_, codePoint) => codePoint),
      0x7f,
    ];
    for (const codePoint of controlCodePoints) {
      expect(HeartbeatHeadersSchema.safeParse({
        "idempotency-key": `prefix${String.fromCharCode(codePoint)}suffix`,
      }).success).toBe(false);
    }
  });

  it("rejects embedded CR, LF, NUL, and tab", () => {
    for (const control of ["\r", "\n", "\0", "\t"]) {
      expect(HeartbeatHeadersSchema.safeParse({
        "idempotency-key": `prefix${control}suffix`,
      }).success).toBe(false);
    }
  });

  it("accepts printable characters adjacent to the rejected ASCII ranges", () => {
    for (const key of ["prefix suffix", "prefix~suffix"]) {
      expect(HeartbeatHeadersSchema.parse({ "idempotency-key": key })).toEqual({
        "idempotency-key": key,
      });
    }
  });

  it("rejects case variants and unknown header keys", () => {
    expect(HeartbeatHeadersSchema.safeParse({ "Idempotency-Key": "request-123" }).success).toBe(
      false,
    );
    expect(HeartbeatHeadersSchema.safeParse({ authorization: "secret" }).success).toBe(false);
  });
});

describe("heartbeat acceptance response", () => {
  it("accepts only the exact response shape", () => {
    const response = { checkId, receivedAt, deduplicated: false } as const;
    expect(HeartbeatAcceptedSchema.parse(response)).toEqual(response);
    expect(HeartbeatAcceptedSchema.safeParse({ ...response, extra: true }).success).toBe(false);
    expect(HeartbeatAcceptedSchema.safeParse({ ...response, checkId: "not-an-id" }).success).toBe(
      false,
    );
    expect(HeartbeatAcceptedSchema.safeParse({ ...response, receivedAt: "not-a-time" }).success).toBe(
      false,
    );
  });
});
