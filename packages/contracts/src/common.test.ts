import { describe, expect, it } from "vitest";
import {
  ChannelIdParamsSchema,
  CorrelationIdSchema,
  CursorPageInfoSchema,
  CursorQuerySchema,
  CursorSchema,
  DEFAULT_PAGE_SIZE,
  DeliveryIdParamsSchema,
  IdSchema,
  IncidentIdParamsSchema,
  MAX_PAGE_SIZE,
  MonitorIdParamsSchema,
  OutboundHttpUrlSchema,
  PublicMonitorSlugParamsSchema,
  PublicMonitorSlugSchema,
  SafeMessageSchema,
  TimestampSchema,
} from "./common.js";

describe("common contracts", () => {
  it("accepts RFC 4122 UUIDs, including version 8", () => {
    expect(IdSchema.parse("550e8400-e29b-41d4-a716-446655440000")).toBe(
      "550e8400-e29b-41d4-a716-446655440000",
    );
    expect(IdSchema.parse("018f4f1c-6f4a-8abc-9234-1234567890ab")).toBe(
      "018f4f1c-6f4a-8abc-9234-1234567890ab",
    );
  });

  it("rejects malformed and Unicode-lookalike UUIDs", () => {
    expect(IdSchema.safeParse("550e8400-e29b-41d4-a716-44665544000g").success).toBe(false);
    expect(IdSchema.safeParse("550e8400‐e29b‐41d4‐a716‐446655440000").success).toBe(false);
  });

  it("accepts ISO timestamps with Z or an explicit numeric offset", () => {
    expect(TimestampSchema.safeParse("2026-07-22T12:34:56Z").success).toBe(true);
    expect(TimestampSchema.safeParse("2026-07-22T12:34:56.123+05:30").success).toBe(true);
    expect(TimestampSchema.safeParse("2026-07-22T12:34:56-04:00").success).toBe(true);
  });

  it("rejects invalid timestamps and timestamps without an offset", () => {
    expect(TimestampSchema.safeParse("2026-07-22T12:34:56").success).toBe(false);
    expect(TimestampSchema.safeParse("2026-02-30T12:34:56Z").success).toBe(false);
    expect(TimestampSchema.safeParse("not-a-timestamp").success).toBe(false);
  });

  it("trims correlation IDs and enforces their bounds", () => {
    expect(CorrelationIdSchema.parse("  request-123  ")).toBe("request-123");
    expect(CorrelationIdSchema.safeParse("   ").success).toBe(false);
    expect(CorrelationIdSchema.safeParse("x".repeat(129)).success).toBe(false);
  });

  it("trims safe messages and enforces their bounds", () => {
    expect(SafeMessageSchema.parse("  safe message  ")).toBe("safe message");
    expect(SafeMessageSchema.safeParse("").success).toBe(false);
    expect(SafeMessageSchema.safeParse("x".repeat(500)).success).toBe(true);
    expect(SafeMessageSchema.safeParse("x".repeat(501)).success).toBe(false);
  });

  it("accepts HTTP and HTTPS outbound URLs", () => {
    expect(OutboundHttpUrlSchema.safeParse("http://example.com/path?q=1").success).toBe(true);
    expect(OutboundHttpUrlSchema.safeParse("https://127.0.0.1:8443/health").success).toBe(true);
  });

  it("rejects non-HTTP outbound URL schemes", () => {
    expect(OutboundHttpUrlSchema.safeParse("ftp://example.com/file").success).toBe(false);
    expect(OutboundHttpUrlSchema.safeParse("javascript:alert(1)").success).toBe(false);
  });

  it("rejects outbound URLs containing authority userinfo", () => {
    expect(OutboundHttpUrlSchema.safeParse("https://user@example.com").success).toBe(false);
    expect(OutboundHttpUrlSchema.safeParse("https://user:password@example.com").success).toBe(false);
  });

  it("rejects malformed, empty, and overlong outbound URLs", () => {
    expect(OutboundHttpUrlSchema.safeParse("").success).toBe(false);
    expect(OutboundHttpUrlSchema.safeParse("https:///missing-host").success).toBe(false);
    expect(
      OutboundHttpUrlSchema.safeParse("https://[1:2:3:4:5:6:7:8:9]/health").success,
    ).toBe(false);
    expect(
      OutboundHttpUrlSchema.safeParse(`https://example.com/${"x".repeat(2028)}`).success,
    ).toBe(true);
    expect(OutboundHttpUrlSchema.safeParse(`https://example.com/${"x".repeat(2030)}`).success).toBe(
      false,
    );
  });

  it("accepts canonical public monitor slugs", () => {
    expect(PublicMonitorSlugSchema.parse("api-prod-1")).toBe("api-prod-1");
    expect(PublicMonitorSlugSchema.safeParse("a".repeat(100)).success).toBe(true);
  });

  it("rejects malformed and overlong public monitor slugs", () => {
    for (const slug of ["API-prod", "api_prod", "-api", "api-", "api--prod", ""]) {
      expect(PublicMonitorSlugSchema.safeParse(slug).success).toBe(false);
    }
    expect(PublicMonitorSlugSchema.safeParse("a".repeat(101)).success).toBe(false);
  });

  it("enforces cursor bounds", () => {
    expect(CursorSchema.safeParse("a").success).toBe(true);
    expect(CursorSchema.safeParse("x".repeat(512)).success).toBe(true);
    expect(CursorSchema.safeParse("").success).toBe(false);
    expect(CursorSchema.safeParse("x".repeat(513)).success).toBe(false);
  });

  it("defaults a missing cursor limit", () => {
    expect(CursorQuerySchema.parse({})).toEqual({ limit: DEFAULT_PAGE_SIZE });
    expect(DEFAULT_PAGE_SIZE).toBe(25);
  });

  it("coerces an integer query-string cursor limit", () => {
    expect(CursorQuerySchema.parse({ cursor: "next", limit: "42" })).toEqual({
      cursor: "next",
      limit: 42,
    });
  });

  it("rejects cursor limits below the minimum", () => {
    expect(CursorQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
  });

  it("accepts the minimum cursor limit", () => {
    expect(CursorQuerySchema.parse({ limit: "1" })).toEqual({ limit: 1 });
  });

  it("accepts the maximum cursor limit", () => {
    expect(CursorQuerySchema.parse({ limit: String(MAX_PAGE_SIZE) })).toEqual({ limit: 100 });
    expect(MAX_PAGE_SIZE).toBe(100);
  });

  it("rejects cursor limits above the maximum", () => {
    expect(CursorQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
  });

  it("rejects non-integer cursor limits and unknown query keys", () => {
    expect(CursorQuerySchema.safeParse({ limit: "1.5" }).success).toBe(false);
    expect(CursorQuerySchema.safeParse({ limit: "abc" }).success).toBe(false);
    expect(CursorQuerySchema.safeParse({ extra: true }).success).toBe(false);
  });

  it("validates strict cursor page information", () => {
    expect(CursorPageInfoSchema.parse({ nextCursor: null, hasMore: false })).toEqual({
      nextCursor: null,
      hasMore: false,
    });
    expect(
      CursorPageInfoSchema.safeParse({ nextCursor: "next", hasMore: true, nested: {} }).success,
    ).toBe(false);
  });

  it("validates exact UUID and public slug parameter objects", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    for (const [schema, key] of [
      [MonitorIdParamsSchema, "monitorId"],
      [IncidentIdParamsSchema, "incidentId"],
      [ChannelIdParamsSchema, "channelId"],
      [DeliveryIdParamsSchema, "deliveryId"],
    ] as const) {
      expect(schema.safeParse({ [key]: uuid }).success).toBe(true);
      expect(schema.safeParse({ [key]: uuid, extra: "rejected" }).success).toBe(false);
      expect(schema.safeParse({ [key]: "invalid" }).success).toBe(false);
    }
    expect(PublicMonitorSlugParamsSchema.safeParse({ slug: "api-prod" }).success).toBe(true);
    expect(
      PublicMonitorSlugParamsSchema.safeParse({ slug: "api-prod", extra: "rejected" }).success,
    ).toBe(false);
  });
});
