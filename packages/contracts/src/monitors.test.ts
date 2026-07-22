import { describe, expect, it } from "vitest";
import {
  AcceptedStatusRangeSchema,
  CreateMonitorSchema,
  CreateMonitorResponseSchema,
  HeartbeatTokenResponseSchema,
  HeartbeatMonitorInputSchema,
  HttpMethodSchema,
  HttpMonitorInputSchema,
  LifecycleCommandResponseSchema,
  MonitorKindSchema,
  MonitorLifecycleSchema,
  MonitorListQuerySchema,
  MonitorListResponseSchema,
  MonitorResponseSchema,
  MonitorStateSchema,
  PrivateHeartbeatMonitorSchema,
  PrivateHttpMonitorSchema,
  PrivateMonitorSchema,
  ReplaceMonitorChannelsSchema,
  RequestHeaderSchema,
  UpdateHeartbeatMonitorSchema,
  UpdateHttpMonitorSchema,
  UpdateMonitorSchema,
} from "./monitors.js";

const minimalHttpMonitor = {
  kind: "http",
  name: "API health",
  url: "https://example.com/health",
  method: "GET",
} as const;

const minimalHeartbeatMonitor = {
  kind: "heartbeat",
  name: "Nightly backup",
} as const;

describe("monitor create contracts", () => {
  it("accepts only the approved monitor enum values", () => {
    expect(MonitorKindSchema.options).toEqual(["http", "heartbeat"]);
    expect(MonitorStateSchema.options).toEqual(["pending", "up", "degraded", "down"]);
    expect(MonitorLifecycleSchema.options).toEqual(["active", "paused", "archived"]);
    expect(HttpMethodSchema.options).toEqual(["GET", "HEAD"]);
    expect(HttpMethodSchema.safeParse("POST").success).toBe(false);
  });

  it("applies every HTTP create default while preserving the required method", () => {
    expect(HttpMonitorInputSchema.parse({ ...minimalHttpMonitor, name: "  API health  " })).toEqual({
      kind: "http",
      name: "API health",
      published: false,
      intervalSeconds: 60,
      failureThreshold: 2,
      recoveryThreshold: 1,
      url: "https://example.com/health",
      method: "GET",
      timeoutSeconds: 5,
      acceptedStatus: { min: 200, max: 399 },
      headers: [],
    });
    expect(HttpMonitorInputSchema.safeParse({
      kind: "http",
      name: "API health",
      url: "https://example.com/health",
    }).success).toBe(false);
  });

  it("applies every heartbeat create default", () => {
    expect(HeartbeatMonitorInputSchema.parse({
      ...minimalHeartbeatMonitor,
      name: "  Nightly backup  ",
    })).toEqual({
      kind: "heartbeat",
      name: "Nightly backup",
      published: false,
      intervalSeconds: 60,
      failureThreshold: 2,
      recoveryThreshold: 1,
      gracePeriodSeconds: 60,
    });
  });

  it("accepts custom create values without replacing them with defaults", () => {
    const input = {
      kind: "http",
      name: "Custom monitor",
      published: true,
      intervalSeconds: 120,
      failureThreshold: 3,
      recoveryThreshold: 4,
      url: "http://example.com/status",
      method: "HEAD",
      timeoutSeconds: 10,
      acceptedStatus: { min: 201, max: 204 },
      headers: [{ name: "X-Trace", value: "keep exactly" }],
    } as const;
    expect(CreateMonitorSchema.parse(input)).toEqual(input);
  });

  it("accepts interval bounds and rejects just-outside and non-integer values", () => {
    for (const intervalSeconds of [30, 86_400]) {
      expect(CreateMonitorSchema.safeParse({
        ...minimalHeartbeatMonitor,
        intervalSeconds,
      }).success).toBe(true);
    }
    for (const intervalSeconds of [29, 86_401, 30.5]) {
      expect(CreateMonitorSchema.safeParse({
        ...minimalHeartbeatMonitor,
        intervalSeconds,
      }).success).toBe(false);
    }
  });

  it("accepts heartbeat grace bounds and rejects just-outside and non-integer values", () => {
    for (const gracePeriodSeconds of [0, 86_400]) {
      expect(HeartbeatMonitorInputSchema.safeParse({
        ...minimalHeartbeatMonitor,
        gracePeriodSeconds,
      }).success).toBe(true);
    }
    for (const gracePeriodSeconds of [-1, 86_401, 0.5]) {
      expect(HeartbeatMonitorInputSchema.safeParse({
        ...minimalHeartbeatMonitor,
        gracePeriodSeconds,
      }).success).toBe(false);
    }
  });

  it("accepts failure threshold bounds and rejects just-outside and non-integer values", () => {
    for (const failureThreshold of [1, 10]) {
      expect(CreateMonitorSchema.safeParse({
        ...minimalHeartbeatMonitor,
        failureThreshold,
      }).success).toBe(true);
    }
    for (const failureThreshold of [0, 11, 1.5]) {
      expect(CreateMonitorSchema.safeParse({
        ...minimalHeartbeatMonitor,
        failureThreshold,
      }).success).toBe(false);
    }
  });

  it("accepts recovery threshold bounds and rejects just-outside and non-integer values", () => {
    for (const recoveryThreshold of [1, 10]) {
      expect(CreateMonitorSchema.safeParse({
        ...minimalHeartbeatMonitor,
        recoveryThreshold,
      }).success).toBe(true);
    }
    for (const recoveryThreshold of [0, 11, 1.5]) {
      expect(CreateMonitorSchema.safeParse({
        ...minimalHeartbeatMonitor,
        recoveryThreshold,
      }).success).toBe(false);
    }
  });

  it("accepts HTTP timeout bounds and rejects just-outside and non-integer values", () => {
    for (const timeoutSeconds of [1, 30]) {
      expect(HttpMonitorInputSchema.safeParse({
        ...minimalHttpMonitor,
        timeoutSeconds,
      }).success).toBe(true);
    }
    for (const timeoutSeconds of [0, 31, 1.5]) {
      expect(HttpMonitorInputSchema.safeParse({
        ...minimalHttpMonitor,
        timeoutSeconds,
      }).success).toBe(false);
    }
  });

  it("defaults the accepted status range", () => {
    expect(AcceptedStatusRangeSchema.parse(undefined)).toEqual({ min: 200, max: 399 });
  });

  it("accepts status bounds and ordered ranges", () => {
    expect(AcceptedStatusRangeSchema.parse({ min: 100, max: 599 })).toEqual({
      min: 100,
      max: 599,
    });
    expect(AcceptedStatusRangeSchema.safeParse({ min: 204, max: 204 }).success).toBe(true);
  });

  it("rejects status values outside the bounds, non-integers, and reversed ranges", () => {
    for (const acceptedStatus of [
      { min: 99, max: 399 },
      { min: 200, max: 600 },
      { min: 200.5, max: 399 },
      { min: 400, max: 399 },
    ]) {
      expect(AcceptedStatusRangeSchema.safeParse(acceptedStatus).success).toBe(false);
    }
  });

  it("rejects unknown accepted status fields", () => {
    expect(AcceptedStatusRangeSchema.safeParse({ min: 200, max: 399, code: 200 }).success).toBe(
      false,
    );
  });

  it("trims names and enforces the normalized name bounds", () => {
    expect(CreateMonitorSchema.parse({ ...minimalHeartbeatMonitor, name: "  a  " }).name).toBe("a");
    expect(CreateMonitorSchema.safeParse({ ...minimalHeartbeatMonitor, name: "   " }).success).toBe(
      false,
    );
    expect(CreateMonitorSchema.safeParse({
      ...minimalHeartbeatMonitor,
      name: ` ${"n".repeat(100)} `,
    }).success).toBe(true);
    expect(CreateMonitorSchema.safeParse({
      ...minimalHeartbeatMonitor,
      name: "n".repeat(101),
    }).success).toBe(false);
  });

  it("uses the shared outbound HTTP URL validation", () => {
    expect(HttpMonitorInputSchema.safeParse({
      ...minimalHttpMonitor,
      url: "http://example.com/status",
    }).success).toBe(true);
    for (const url of ["ftp://example.com/status", "https://user@example.com/status", "not a url"]) {
      expect(HttpMonitorInputSchema.safeParse({ ...minimalHttpMonitor, url }).success).toBe(false);
    }
  });

  it("validates exact request header shape and RFC HTTP token names", () => {
    const header = { name: "X-Request_ID!#$%&'*+-.^`|~", value: "  unchanged  " };
    expect(RequestHeaderSchema.parse(header)).toEqual(header);
    for (const name of ["", "bad header", "bad:header", "x".repeat(129), "café"]) {
      expect(RequestHeaderSchema.safeParse({ name, value: "ok" }).success).toBe(false);
    }
    expect(RequestHeaderSchema.safeParse({ name: "X-Header", value: "v".repeat(1024) }).success).toBe(
      true,
    );
    expect(RequestHeaderSchema.safeParse({ name: "X-Header", value: "v".repeat(1025) }).success).toBe(
      false,
    );
    expect(RequestHeaderSchema.safeParse({ name: "X-Header", value: "", extra: true }).success).toBe(
      false,
    );
  });

  it("accepts at most 20 headers", () => {
    const headers = Array.from({ length: 20 }, (_, index) => ({
      name: `X-Header-${String(index)}`,
      value: String(index),
    }));
    expect(HttpMonitorInputSchema.safeParse({ ...minimalHttpMonitor, headers }).success).toBe(true);
    expect(HttpMonitorInputSchema.safeParse({
      ...minimalHttpMonitor,
      headers: [...headers, { name: "X-Header-20", value: "20" }],
    }).success).toBe(false);
  });

  it("rejects unknown create fields and unknown nested fields", () => {
    expect(CreateMonitorSchema.safeParse({ ...minimalHttpMonitor, lifecycle: "active" }).success).toBe(
      false,
    );
    expect(HttpMonitorInputSchema.safeParse({
      ...minimalHttpMonitor,
      headers: [{ name: "X-Header", value: "ok", enabled: true }],
    }).success).toBe(false);
  });

  it("rejects fields belonging to the other monitor kind", () => {
    expect(CreateMonitorSchema.safeParse({
      ...minimalHttpMonitor,
      gracePeriodSeconds: 60,
    }).success).toBe(false);
    expect(CreateMonitorSchema.safeParse({
      ...minimalHeartbeatMonitor,
      url: "https://example.com",
      method: "GET",
    }).success).toBe(false);
  });
});

describe("request header security", () => {
  it("rejects case-insensitive duplicate header names", () => {
    expect(HttpMonitorInputSchema.safeParse({
      ...minimalHttpMonitor,
      headers: [
        { name: "X-Trace", value: "first" },
        { name: "x-tRaCe", value: "second" },
      ],
    }).success).toBe(false);
  });

  it("rejects every forbidden exact header name case-insensitively", () => {
    for (const name of [
      "authorization",
      "Proxy-Authorization",
      "COOKIE",
      "Set-Cookie",
      "hOsT",
    ]) {
      expect(RequestHeaderSchema.safeParse({ name, value: "ordinary" }).success).toBe(false);
    }
  });

  it("rejects every forbidden header-name pattern family", () => {
    for (const name of [
      "X-AUTH-Mode",
      "x_token_value",
      "x-apikey-value",
      "x-api-key-value",
      "x_api_key_value",
      "client-SECRET",
      "access_credential_id",
      "db-PASSWORD-hint",
    ]) {
      expect(RequestHeaderSchema.safeParse({ name, value: "ordinary" }).success).toBe(false);
    }
  });

  it("rejects credential-scheme values after trimming and without regard to case", () => {
    for (const value of [
      " Basic Zm9vOmJhcg==",
      "\tBEARER opaque-value",
      "  ToKeN credential-value  ",
    ]) {
      expect(RequestHeaderSchema.safeParse({ name: "X-Metadata", value }).success).toBe(false);
    }
  });

  it("rejects three-segment base64url JWT values", () => {
    for (const value of [
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature_-123",
      "  abc.DEF_123.xyz-789  ",
    ]) {
      expect(RequestHeaderSchema.safeParse({ name: "X-Metadata", value }).success).toBe(false);
    }
  });

  it("rejects values containing AWS access key identifiers", () => {
    for (const value of [
      "AKIA1234567890ABCDEF",
      "prefix-AKIAABCDEFGHIJKLMNOP-suffix",
      "AKIA1234567890ABCDEFGH",
    ]) {
      expect(RequestHeaderSchema.safeParse({ name: "X-Metadata", value }).success).toBe(false);
    }
  });

  it("allows security near-misses and ordinary headers", () => {
    const headers = [
      { name: "Authorization-Mode", value: "Basic" },
      { name: "X-Tokenized", value: "BearerToken ordinary" },
      { name: "X-API-Keyboard", value: "tokenized value" },
      { name: "X-Secrets", value: "abc.def" },
      { name: "X-Credentials", value: "abc.def.ghi.jkl" },
      { name: "X-Passwordless", value: "akia1234567890abcdef" },
      { name: "X-Ordinary", value: "AKIA1234567890abcDEF" },
    ];
    expect(HttpMonitorInputSchema.parse({ ...minimalHttpMonitor, headers }).headers).toEqual(headers);
  });

  it("preserves successful header names and values exactly", () => {
    const headers = [{ name: "X-MiXeD_Case", value: "  ordinary value  " }];
    expect(HttpMonitorInputSchema.parse({ ...minimalHttpMonitor, headers }).headers).toEqual(headers);
  });
});

const firstId = "550e8400-e29b-41d4-a716-446655440000";
const secondId = "018f4f1c-6f4a-4abc-9234-1234567890ab";
const timestamp = "2026-07-22T12:34:56Z";
const validIncident = {
  id: secondId,
  status: "open",
  startedAt: timestamp,
  latestCause: {
    category: "http_status",
    code: "HTTP_503",
    httpStatus: 503,
    safeSummary: "Service unavailable",
  },
} as const;

const privateCommon = {
  id: firstId,
  name: "API health",
  state: "pending",
  lifecycle: "active",
  published: false,
  publicSlug: null,
  intervalSeconds: 60,
  failureThreshold: 2,
  recoveryThreshold: 1,
  consecutiveFailures: 0,
  consecutiveSuccesses: 0,
  generation: 0,
  nextSequence: 1,
  lastEvaluatedSequence: 0,
  lastEvaluatedCheckAt: null,
  activeIncident: null,
  notificationChannelIds: [],
  createdAt: timestamp,
  updatedAt: timestamp,
} as const;

const privateHttpMonitor = {
  ...privateCommon,
  kind: "http",
  url: "https://example.com/health",
  method: "GET",
  timeoutSeconds: 5,
  acceptedStatus: { min: 200, max: 399 },
  headers: [{ name: "X-Trace", value: "ordinary" }],
  nextCheckAt: null,
} as const;

const privateHeartbeatMonitor = {
  ...privateCommon,
  kind: "heartbeat",
  gracePeriodSeconds: 60,
  lastHeartbeatAt: null,
  nextHeartbeatDeadline: null,
} as const;

describe("monitor update contracts", () => {
  it("accepts every mutable HTTP field without injecting omitted defaults", () => {
    const update = {
      kind: "http",
      name: "  Renamed HTTP  ",
      published: true,
      intervalSeconds: 120,
      failureThreshold: 3,
      recoveryThreshold: 4,
      url: "https://example.com/new",
      method: "HEAD",
      timeoutSeconds: 10,
      acceptedStatus: { min: 201, max: 299 },
      headers: [{ name: "X-Trace", value: "ordinary" }],
    } as const;
    expect(UpdateHttpMonitorSchema.parse(update)).toEqual({ ...update, name: "Renamed HTTP" });
    expect(UpdateHttpMonitorSchema.parse({ kind: "http", published: true })).toEqual({
      kind: "http",
      published: true,
    });
  });

  it("accepts every mutable heartbeat field without injecting omitted defaults", () => {
    const update = {
      kind: "heartbeat",
      name: "Heartbeat renamed",
      published: true,
      intervalSeconds: 90,
      failureThreshold: 5,
      recoveryThreshold: 6,
      gracePeriodSeconds: 30,
    } as const;
    expect(UpdateHeartbeatMonitorSchema.parse(update)).toEqual(update);
    expect(UpdateHeartbeatMonitorSchema.parse({ kind: "heartbeat", gracePeriodSeconds: 0 })).toEqual({
      kind: "heartbeat",
      gracePeriodSeconds: 0,
    });
  });

  it("requires the immutable kind discriminant and at least one mutable change", () => {
    expect(UpdateHttpMonitorSchema.safeParse({ kind: "http" }).success).toBe(false);
    expect(UpdateHeartbeatMonitorSchema.safeParse({ kind: "heartbeat" }).success).toBe(false);
    expect(UpdateMonitorSchema.safeParse({ name: "Missing kind" }).success).toBe(false);
    expect(UpdateHttpMonitorSchema.safeParse({ kind: "http", name: undefined }).success).toBe(false);
  });

  it("dispatches update parsing by monitor kind", () => {
    expect(UpdateMonitorSchema.parse({ kind: "http", method: "HEAD" })).toEqual({
      kind: "http",
      method: "HEAD",
    });
    expect(UpdateMonitorSchema.parse({ kind: "heartbeat", gracePeriodSeconds: 10 })).toEqual({
      kind: "heartbeat",
      gracePeriodSeconds: 10,
    });
  });

  it("rejects immutable, generated, secret, timestamp, and unknown update fields", () => {
    for (const forbiddenChange of [
      { state: "up" },
      { lifecycle: "paused" },
      { publicSlug: "api-health" },
      { consecutiveFailures: 1 },
      { consecutiveSuccesses: 1 },
      { generation: 1 },
      { nextSequence: 2 },
      { lastEvaluatedSequence: 1 },
      { token: "x".repeat(43) },
      { createdAt: timestamp },
      { updatedAt: timestamp },
      { unknown: true },
    ]) {
      expect(UpdateHttpMonitorSchema.safeParse({
        kind: "http",
        name: "Valid change",
        ...forbiddenChange,
      }).success).toBe(false);
    }
  });

  it("rejects subtype fields from the wrong update kind", () => {
    expect(UpdateHttpMonitorSchema.safeParse({
      kind: "http",
      gracePeriodSeconds: 60,
    }).success).toBe(false);
    for (const forbiddenChange of [
      { url: "https://example.com" },
      { method: "GET" },
      { timeoutSeconds: 5 },
      { acceptedStatus: { min: 200, max: 399 } },
      { headers: [] },
    ]) {
      expect(UpdateHeartbeatMonitorSchema.safeParse({
        kind: "heartbeat",
        name: "Valid change",
        ...forbiddenChange,
      }).success).toBe(false);
    }
  });

  it("enforces create field bounds on optional update values", () => {
    expect(UpdateHttpMonitorSchema.safeParse({ kind: "http", intervalSeconds: 29 }).success).toBe(
      false,
    );
    expect(UpdateHeartbeatMonitorSchema.safeParse({
      kind: "heartbeat",
      gracePeriodSeconds: 86_401,
    }).success).toBe(false);
    expect(UpdateHttpMonitorSchema.safeParse({ kind: "http", headers: [
      { name: "X-Trace", value: "one" },
      { name: "x-trace", value: "two" },
    ] }).success).toBe(false);
  });
});

describe("private monitor projections", () => {
  it("accepts an exact private HTTP monitor", () => {
    expect(PrivateHttpMonitorSchema.parse(privateHttpMonitor)).toEqual(privateHttpMonitor);
    expect(PrivateMonitorSchema.parse(privateHttpMonitor)).toEqual(privateHttpMonitor);
  });

  it("accepts an exact private heartbeat monitor", () => {
    expect(PrivateHeartbeatMonitorSchema.parse(privateHeartbeatMonitor)).toEqual(
      privateHeartbeatMonitor,
    );
    expect(PrivateMonitorSchema.parse(privateHeartbeatMonitor)).toEqual(privateHeartbeatMonitor);
  });

  it("accepts public slug, timestamps, notification IDs, and an imported incident summary", () => {
    const monitor = {
      ...privateHttpMonitor,
      publicSlug: "api-health",
      lastEvaluatedCheckAt: timestamp,
      nextCheckAt: timestamp,
      activeIncident: validIncident,
      notificationChannelIds: [firstId, secondId],
    };
    expect(PrivateHttpMonitorSchema.parse(monitor)).toEqual(monitor);
  });

  it("rejects unknown and wrong-kind private projection fields", () => {
    expect(PrivateHttpMonitorSchema.safeParse({
      ...privateHttpMonitor,
      gracePeriodSeconds: 60,
    }).success).toBe(false);
    expect(PrivateHeartbeatMonitorSchema.safeParse({
      ...privateHeartbeatMonitor,
      url: "https://example.com",
    }).success).toBe(false);
    expect(PrivateMonitorSchema.safeParse({ ...privateHttpMonitor, unknown: true }).success).toBe(
      false,
    );
  });

  it("never accepts heartbeat tokens in private projections", () => {
    expect(PrivateHeartbeatMonitorSchema.safeParse({
      ...privateHeartbeatMonitor,
      token: "a".repeat(43),
    }).success).toBe(false);
  });

  it("requires nonnegative safe integer counters and generations", () => {
    for (const field of [
      "consecutiveFailures",
      "consecutiveSuccesses",
      "generation",
      "lastEvaluatedSequence",
    ] as const) {
      expect(PrivateHttpMonitorSchema.safeParse({ ...privateHttpMonitor, [field]: -1 }).success).toBe(
        false,
      );
      expect(PrivateHttpMonitorSchema.safeParse({
        ...privateHttpMonitor,
        [field]: Number.MAX_SAFE_INTEGER + 1,
      }).success).toBe(false);
      expect(PrivateHttpMonitorSchema.safeParse({ ...privateHttpMonitor, [field]: 1.5 }).success).toBe(
        false,
      );
    }
  });

  it("requires next sequence to be a positive safe integer", () => {
    for (const nextSequence of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(PrivateHeartbeatMonitorSchema.safeParse({
        ...privateHeartbeatMonitor,
        nextSequence,
      }).success).toBe(false);
    }
  });

  it("requires next sequence to exceed the last evaluated sequence", () => {
    expect(PrivateHttpMonitorSchema.safeParse({
      ...privateHttpMonitor,
      nextSequence: 4,
      lastEvaluatedSequence: 4,
    }).success).toBe(false);
    expect(PrivateHttpMonitorSchema.safeParse({
      ...privateHttpMonitor,
      nextSequence: 4,
      lastEvaluatedSequence: 5,
    }).success).toBe(false);
    expect(PrivateHttpMonitorSchema.safeParse({
      ...privateHttpMonitor,
      nextSequence: 5,
      lastEvaluatedSequence: 4,
    }).success).toBe(true);
  });

  it("requires unique notification channel IDs and enforces the maximum", () => {
    expect(PrivateHttpMonitorSchema.safeParse({
      ...privateHttpMonitor,
      notificationChannelIds: [firstId, firstId],
    }).success).toBe(false);
    const ids = Array.from({ length: 100 }, (_, index) =>
      `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    );
    expect(PrivateHttpMonitorSchema.safeParse({
      ...privateHttpMonitor,
      notificationChannelIds: ids,
    }).success).toBe(true);
    expect(PrivateHttpMonitorSchema.safeParse({
      ...privateHttpMonitor,
      notificationChannelIds: [...ids, "00000000-0000-4000-8000-000000000100"],
    }).success).toBe(false);
  });
});

describe("monitor query and channel contracts", () => {
  it("inherits the default cursor limit and adds no other defaults", () => {
    expect(MonitorListQuerySchema.parse({})).toEqual({ limit: 25 });
  });

  it("matches cursor query coercion and bounds", () => {
    expect(MonitorListQuerySchema.parse({ cursor: "next", limit: "100" })).toEqual({
      cursor: "next",
      limit: 100,
    });
    expect(MonitorListQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
    expect(MonitorListQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
  });

  it("accepts monitor enum filters", () => {
    const query = {
      kind: "heartbeat",
      state: "degraded",
      lifecycle: "paused",
      published: true,
    } as const;
    expect(MonitorListQuerySchema.parse(query)).toEqual({ ...query, limit: 25 });
  });

  it("parses only exact query-string booleans", () => {
    expect(MonitorListQuerySchema.parse({ published: "true" }).published).toBe(true);
    expect(MonitorListQuerySchema.parse({ published: "false" }).published).toBe(false);
    for (const published of ["TRUE", "False", "1", "yes", "", 1]) {
      expect(MonitorListQuerySchema.safeParse({ published }).success).toBe(false);
    }
  });

  it("rejects invalid filters and unknown query keys", () => {
    expect(MonitorListQuerySchema.safeParse({ kind: "tcp" }).success).toBe(false);
    expect(MonitorListQuerySchema.safeParse({ state: "unknown" }).success).toBe(false);
    expect(MonitorListQuerySchema.safeParse({ lifecycle: "deleted" }).success).toBe(false);
    expect(MonitorListQuerySchema.safeParse({ extra: true }).success).toBe(false);
  });

  it("accepts exact unique channel ID replacements up to 100 IDs", () => {
    expect(ReplaceMonitorChannelsSchema.parse({ channelIds: [firstId, secondId] })).toEqual({
      channelIds: [firstId, secondId],
    });
    expect(ReplaceMonitorChannelsSchema.safeParse({
      channelIds: [firstId, firstId],
    }).success).toBe(false);
    expect(ReplaceMonitorChannelsSchema.safeParse({ channelIds: [], extra: true }).success).toBe(
      false,
    );
    const ids = Array.from({ length: 101 }, (_, index) =>
      `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    );
    expect(ReplaceMonitorChannelsSchema.safeParse({ channelIds: ids }).success).toBe(false);
  });
});

const heartbeatCredentials = {
  token: "a".repeat(43),
  pingPath: "/v1/heartbeats/monitor-id",
} as const;

describe("monitor response envelopes", () => {
  it("validates an exact monitor list response", () => {
    const response = {
      items: [privateHttpMonitor, privateHeartbeatMonitor],
      page: { nextCursor: null, hasMore: false },
    } as const;
    expect(MonitorListResponseSchema.parse(response)).toEqual(response);
    expect(MonitorListResponseSchema.safeParse({ ...response, token: "a".repeat(43) }).success).toBe(
      false,
    );
  });

  it("validates an exact single-monitor response", () => {
    expect(MonitorResponseSchema.parse({ monitor: privateHttpMonitor })).toEqual({
      monitor: privateHttpMonitor,
    });
    expect(MonitorResponseSchema.safeParse({
      monitor: privateHttpMonitor,
      extra: true,
    }).success).toBe(false);
  });

  it("validates the separately named lifecycle command response", () => {
    expect(LifecycleCommandResponseSchema.parse({ monitor: privateHeartbeatMonitor })).toEqual({
      monitor: privateHeartbeatMonitor,
    });
    expect(LifecycleCommandResponseSchema.safeParse({
      monitor: { ...privateHeartbeatMonitor, token: "a".repeat(43) },
    }).success).toBe(false);
  });

  it("returns only the private monitor for HTTP creates", () => {
    expect(CreateMonitorResponseSchema.parse({ monitor: privateHttpMonitor })).toEqual({
      monitor: privateHttpMonitor,
    });
    expect(CreateMonitorResponseSchema.safeParse({
      monitor: privateHttpMonitor,
      heartbeat: heartbeatCredentials,
    }).success).toBe(false);
  });

  it("requires one-time credentials for heartbeat creates", () => {
    const response = { monitor: privateHeartbeatMonitor, heartbeat: heartbeatCredentials } as const;
    expect(CreateMonitorResponseSchema.parse(response)).toEqual(response);
    expect(CreateMonitorResponseSchema.safeParse({ monitor: privateHeartbeatMonitor }).success).toBe(
      false,
    );
    expect(CreateMonitorResponseSchema.safeParse({
      ...response,
      heartbeat: { ...heartbeatCredentials, extra: true },
    }).success).toBe(false);
  });

  it("enforces heartbeat token length and base64url alphabet", () => {
    for (const token of ["a".repeat(42), "a".repeat(129), `${"a".repeat(42)}+`]) {
      expect(CreateMonitorResponseSchema.safeParse({
        monitor: privateHeartbeatMonitor,
        heartbeat: { ...heartbeatCredentials, token },
      }).success).toBe(false);
    }
    expect(CreateMonitorResponseSchema.safeParse({
      monitor: privateHeartbeatMonitor,
      heartbeat: { ...heartbeatCredentials, token: `${"A".repeat(42)}_` },
    }).success).toBe(true);
  });

  it("requires a bounded relative heartbeat ping path with the approved prefix", () => {
    for (const pingPath of [
      "",
      "/v1/monitors/id",
      "https://example.com/v1/heartbeats/id",
      `/v1/heartbeats/${"x".repeat(2034)}`,
    ]) {
      expect(CreateMonitorResponseSchema.safeParse({
        monitor: privateHeartbeatMonitor,
        heartbeat: { ...heartbeatCredentials, pingPath },
      }).success).toBe(false);
    }
  });

  it("validates exact heartbeat token rotation responses", () => {
    const response = { ...heartbeatCredentials, rotatedAt: timestamp };
    expect(HeartbeatTokenResponseSchema.parse(response)).toEqual(response);
    expect(HeartbeatTokenResponseSchema.safeParse({ ...response, extra: true }).success).toBe(false);
    expect(HeartbeatTokenResponseSchema.safeParse({ ...response, rotatedAt: "not-a-time" }).success).toBe(
      false,
    );
  });
});
