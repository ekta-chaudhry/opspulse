import { describe, expect, it } from "vitest";
import { IncidentSummarySchema } from "./incident-summary.js";

const validIncident = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  status: "open",
  startedAt: "2026-07-22T12:34:56Z",
  latestCause: {
    category: "http_status",
    code: "HTTP_503",
    httpStatus: 503,
    safeSummary: "Service unavailable",
  },
} as const;

describe("incident summary contract", () => {
  it("accepts an exact open incident summary", () => {
    expect(IncidentSummarySchema.parse(validIncident)).toEqual(validIncident);
  });

  it("requires the literal open status", () => {
    expect(IncidentSummarySchema.safeParse({ ...validIncident, status: "resolved" }).success).toBe(
      false,
    );
    const withoutStatus = {
      id: validIncident.id,
      startedAt: validIncident.startedAt,
      latestCause: validIncident.latestCause,
    };
    expect(IncidentSummarySchema.safeParse(withoutStatus).success).toBe(false);
  });

  it("rejects unknown incident summary fields", () => {
    expect(IncidentSummarySchema.safeParse({ ...validIncident, resolvedAt: null }).success).toBe(false);
  });

  it("rejects malformed nested failure causes", () => {
    expect(
      IncidentSummarySchema.safeParse({
        ...validIncident,
        latestCause: { ...validIncident.latestCause, category: "timeout" },
      }).success,
    ).toBe(false);
    expect(
      IncidentSummarySchema.safeParse({
        ...validIncident,
        latestCause: { ...validIncident.latestCause, safeSummary: "" },
      }).success,
    ).toBe(false);
  });

  it("rejects unknown nested failure cause fields", () => {
    expect(
      IncidentSummarySchema.safeParse({
        ...validIncident,
        latestCause: { ...validIncident.latestCause, secret: "internal" },
      }).success,
    ).toBe(false);
  });
});
