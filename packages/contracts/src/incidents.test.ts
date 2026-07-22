import { describe, expect, it } from "vitest";
import {
  IncidentListQuerySchema,
  IncidentListResponseSchema,
  IncidentSchema,
  IncidentStatusSchema,
  ResolutionReasonSchema,
} from "./incidents.js";

const incidentId = "550e8400-e29b-41d4-a716-446655440000";
const monitorId = "018f4f1c-6f4a-4abc-9234-1234567890ab";
const startedAt = "2026-07-22T12:00:00Z";
const resolvedAt = "2026-07-22T12:05:00Z";
const timeoutCause = {
  category: "timeout",
  code: "ETIMEDOUT",
  httpStatus: null,
  safeSummary: "Request timed out",
} as const;
const networkCause = {
  category: "network",
  code: "ENETUNREACH",
  httpStatus: null,
  safeSummary: "Network unavailable",
} as const;

const openIncident = {
  id: incidentId,
  monitorId,
  monitorName: "API health",
  status: "open",
  startedAt,
  resolvedAt: null,
  openingCause: timeoutCause,
  latestCause: networkCause,
  resolutionReason: null,
} as const;

const resolvedIncident = {
  ...openIncident,
  status: "resolved",
  resolvedAt,
  resolutionReason: "recovered",
} as const;

describe("incident contracts", () => {
  it("accepts only the approved status and resolution literals", () => {
    expect(IncidentStatusSchema.options).toEqual(["open", "resolved"]);
    expect(ResolutionReasonSchema.options).toEqual(["recovered", "monitor_archived"]);
    expect(IncidentStatusSchema.safeParse("closed").success).toBe(false);
    expect(ResolutionReasonSchema.safeParse("manual").success).toBe(false);
  });

  it("accepts exact open and resolved incidents", () => {
    expect(IncidentSchema.parse(openIncident)).toEqual(openIncident);
    expect(IncidentSchema.parse(resolvedIncident)).toEqual(resolvedIncident);
  });

  it("rejects unknown incident keys", () => {
    expect(IncidentSchema.safeParse({ ...openIncident, internalNotes: "secret" }).success).toBe(
      false,
    );
  });

  it("trims monitor names and enforces normalized bounds", () => {
    expect(IncidentSchema.parse({ ...openIncident, monitorName: "  API health  " }).monitorName).toBe(
      "API health",
    );
    expect(IncidentSchema.safeParse({ ...openIncident, monitorName: "   " }).success).toBe(false);
    expect(IncidentSchema.safeParse({
      ...openIncident,
      monitorName: ` ${"m".repeat(100)} `,
    }).success).toBe(true);
    expect(IncidentSchema.safeParse({
      ...openIncident,
      monitorName: "m".repeat(101),
    }).success).toBe(false);
  });

  it("requires null resolution fields for open incidents", () => {
    expect(IncidentSchema.safeParse({ ...openIncident, resolvedAt }).success).toBe(false);
    expect(IncidentSchema.safeParse({
      ...openIncident,
      resolutionReason: "monitor_archived",
    }).success).toBe(false);
  });

  it("requires both resolution fields for resolved incidents", () => {
    expect(IncidentSchema.safeParse({ ...resolvedIncident, resolvedAt: null }).success).toBe(false);
    expect(IncidentSchema.safeParse({ ...resolvedIncident, resolutionReason: null }).success).toBe(
      false,
    );
  });

  it("rejects resolutions before incident start with a useful path", () => {
    const result = IncidentSchema.safeParse({
      ...resolvedIncident,
      resolvedAt: "2026-07-22T11:59:59Z",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["resolvedAt"]);
      expect(result.error.issues[0]?.message).toBe(
        "resolvedAt must be greater than or equal to startedAt",
      );
    }
  });

  it("orders incident resolution timestamps beyond milliseconds and across offsets", () => {
    expect(IncidentSchema.safeParse({
      ...resolvedIncident,
      startedAt: "2026-07-22T12:00:00.0001Z",
      resolvedAt: "2026-07-22T12:00:00.0009Z",
    }).success).toBe(true);
    expect(IncidentSchema.safeParse({
      ...resolvedIncident,
      startedAt: "2026-07-22T12:00:00.0009Z",
      resolvedAt: "2026-07-22T12:00:00.0001Z",
    }).success).toBe(false);
    expect(IncidentSchema.safeParse({
      ...resolvedIncident,
      startedAt: "2026-07-22T13:00:00.0001+01:00",
      resolvedAt: "2026-07-22T12:00:00.0001Z",
    }).success).toBe(true);
  });

  it("rejects malformed opening and latest causes at useful nested paths", () => {
    const openingResult = IncidentSchema.safeParse({
      ...openIncident,
      openingCause: { ...timeoutCause, httpStatus: 500 },
    });
    expect(openingResult.success).toBe(false);
    if (!openingResult.success) {
      expect(openingResult.error.issues[0]?.path).toEqual(["openingCause", "httpStatus"]);
    }

    const latestResult = IncidentSchema.safeParse({
      ...openIncident,
      latestCause: { ...networkCause, internalMessage: "secret" },
    });
    expect(latestResult.success).toBe(false);
    if (!latestResult.success) {
      expect(latestResult.error.issues[0]?.path[0]).toBe("latestCause");
    }
  });
});

describe("incident list contracts", () => {
  it("inherits cursor pagination and accepts every optional filter", () => {
    expect(IncidentListQuerySchema.parse({})).toEqual({ limit: 25 });
    expect(IncidentListQuerySchema.parse({
      cursor: "next",
      limit: "100",
      monitorId,
      status: "resolved",
      from: startedAt,
      to: resolvedAt,
    })).toEqual({
      cursor: "next",
      limit: 100,
      monitorId,
      status: "resolved",
      from: startedAt,
      to: resolvedAt,
    });
  });

  it("rejects invalid filters and unknown query keys", () => {
    expect(IncidentListQuerySchema.safeParse({ monitorId: "not-an-id" }).success).toBe(false);
    expect(IncidentListQuerySchema.safeParse({ status: "closed" }).success).toBe(false);
    expect(IncidentListQuerySchema.safeParse({ extra: true }).success).toBe(false);
  });

  it("rejects reversed query ranges with a useful path", () => {
    const result = IncidentListQuerySchema.safeParse({ from: resolvedAt, to: startedAt });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["to"]);
      expect(result.error.issues[0]?.message).toBe("to must be greater than or equal to from");
    }
  });

  it("orders incident query ranges beyond milliseconds and across offsets", () => {
    expect(IncidentListQuerySchema.safeParse({
      from: "2026-07-22T12:00:00.0001Z",
      to: "2026-07-22T12:00:00.0009Z",
    }).success).toBe(true);
    expect(IncidentListQuerySchema.safeParse({
      from: "2026-07-22T12:00:00.0009Z",
      to: "2026-07-22T12:00:00.0001Z",
    }).success).toBe(false);
    expect(IncidentListQuerySchema.safeParse({
      from: "2026-07-22T13:00:00.0001+01:00",
      to: "2026-07-22T12:00:00.0001Z",
    }).success).toBe(true);
  });

  it("validates an exact paginated incident response", () => {
    const response = {
      items: [openIncident, resolvedIncident],
      page: { nextCursor: "next", hasMore: true },
    } as const;
    expect(IncidentListResponseSchema.parse(response)).toEqual(response);
    expect(IncidentListResponseSchema.safeParse({ ...response, extra: true }).success).toBe(false);
    expect(IncidentListResponseSchema.safeParse({
      ...response,
      page: { ...response.page, extra: true },
    }).success).toBe(false);
  });
});
