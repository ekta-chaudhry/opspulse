import { describe, expect, it } from "vitest";
import {
  CheckHistoryItemSchema,
  CheckListQuerySchema,
  CheckListResponseSchema,
  CheckRequestSchema,
  CheckRequestSourceSchema,
  CheckRequestStatusSchema,
  CheckResultSchema,
  CheckRunSchema,
  CompletedCheckHistoryItemSchema,
  MonitoringErrorSchema,
} from "./checks.js";

const checkId = "550e8400-e29b-41d4-a716-446655440000";
const monitorId = "018f4f1c-6f4a-4abc-9234-1234567890ab";
const runId = "b7d6f4a6-0b1d-4b55-9a34-5072f6116c43";
const createdAt = "2026-07-22T12:00:00Z";
const terminalAt = "2026-07-22T12:01:00Z";

const timeoutCause = {
  category: "timeout",
  code: "ETIMEDOUT",
  httpStatus: null,
  safeSummary: "Request timed out",
} as const;

const pendingRequest = {
  id: checkId,
  monitorId,
  generation: 0,
  sequence: 1,
  source: "http_schedule",
  scheduledAt: createdAt,
  status: "pending",
  createdAt,
  terminalAt: null,
} as const;

const completedRequest = {
  ...pendingRequest,
  status: "completed",
  terminalAt,
} as const;

const cancelledRequest = {
  ...pendingRequest,
  source: "heartbeat_deadline",
  status: "cancelled-internal",
  terminalAt,
} as const;

const successfulRun = {
  id: runId,
  checkRequestId: checkId,
  monitorId,
  generation: 0,
  sequence: 1,
  result: "success",
  httpStatus: 204,
  latencyMs: 25,
  cause: null,
  completedAt: terminalAt,
  createdAt,
  evaluatedAt: terminalAt,
} as const;

describe("check request contracts", () => {
  it("accepts only the exact source, status, and result literals", () => {
    expect(CheckRequestSourceSchema.options).toEqual([
      "http_schedule",
      "heartbeat_ping",
      "heartbeat_deadline",
    ]);
    expect(CheckRequestStatusSchema.options).toEqual([
      "pending",
      "completed",
      "cancelled-internal",
    ]);
    expect(CheckResultSchema.options).toEqual(["success", "failure", "timeout"]);
    expect(CheckRequestSourceSchema.safeParse("manual").success).toBe(false);
    expect(CheckRequestStatusSchema.safeParse("cancelled").success).toBe(false);
    expect(CheckResultSchema.safeParse("error").success).toBe(false);
  });

  it("accepts every terminal-state branch with exact keys", () => {
    for (const request of [pendingRequest, completedRequest, cancelledRequest]) {
      expect(CheckRequestSchema.parse(request)).toEqual(request);
      expect(CheckRequestSchema.safeParse({ ...request, extra: true }).success).toBe(false);
    }
  });

  it("enforces status-specific terminal timestamps", () => {
    expect(CheckRequestSchema.safeParse({ ...pendingRequest, terminalAt }).success).toBe(false);
    expect(CheckRequestSchema.safeParse({ ...completedRequest, terminalAt: null }).success).toBe(
      false,
    );
    expect(CheckRequestSchema.safeParse({ ...cancelledRequest, terminalAt: null }).success).toBe(
      false,
    );
  });

  it("rejects terminal timestamps before creation with a useful path", () => {
    const result = CheckRequestSchema.safeParse({
      ...completedRequest,
      terminalAt: "2026-07-22T11:59:59Z",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["terminalAt"]);
      expect(result.error.issues[0]?.message).toBe(
        "terminalAt must be greater than or equal to createdAt",
      );
    }
  });

  it("requires safe generation and sequence boundaries", () => {
    expect(CheckRequestSchema.safeParse({
      ...pendingRequest,
      generation: Number.MAX_SAFE_INTEGER,
      sequence: Number.MAX_SAFE_INTEGER,
    }).success).toBe(true);
    for (const generation of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(CheckRequestSchema.safeParse({ ...pendingRequest, generation }).success).toBe(false);
    }
    for (const sequence of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(CheckRequestSchema.safeParse({ ...pendingRequest, sequence }).success).toBe(false);
    }
  });
});

describe("check run contracts", () => {
  it("accepts exact success, failure, and timeout runs", () => {
    expect(CheckRunSchema.parse(successfulRun)).toEqual(successfulRun);
    expect(CheckRunSchema.safeParse({
      ...successfulRun,
      result: "failure",
      cause: timeoutCause,
    }).success).toBe(true);
    expect(CheckRunSchema.safeParse({
      ...successfulRun,
      checkRequestId: null,
      result: "timeout",
      httpStatus: null,
      latencyMs: null,
      cause: timeoutCause,
    }).success).toBe(true);
    expect(CheckRunSchema.safeParse({ ...successfulRun, extra: true }).success).toBe(false);
  });

  it("enforces safe generation, sequence, and latency values", () => {
    expect(CheckRunSchema.safeParse({
      ...successfulRun,
      generation: Number.MAX_SAFE_INTEGER,
      sequence: Number.MAX_SAFE_INTEGER,
      latencyMs: Number.MAX_SAFE_INTEGER,
    }).success).toBe(true);
    for (const generation of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(CheckRunSchema.safeParse({ ...successfulRun, generation }).success).toBe(false);
    }
    for (const sequence of [0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(CheckRunSchema.safeParse({ ...successfulRun, sequence }).success).toBe(false);
    }
    for (const latencyMs of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(CheckRunSchema.safeParse({ ...successfulRun, latencyMs }).success).toBe(false);
    }
  });

  it("enforces HTTP status bounds", () => {
    for (const httpStatus of [null, 100, 599]) {
      expect(CheckRunSchema.safeParse({ ...successfulRun, httpStatus }).success).toBe(true);
    }
    for (const httpStatus of [99, 600, 200.5]) {
      expect(CheckRunSchema.safeParse({ ...successfulRun, httpStatus }).success).toBe(false);
    }
  });

  it("requires causes only for unsuccessful results with useful paths", () => {
    const successWithCause = CheckRunSchema.safeParse({ ...successfulRun, cause: timeoutCause });
    expect(successWithCause.success).toBe(false);
    if (!successWithCause.success) {
      expect(successWithCause.error.issues[0]?.path).toEqual(["cause"]);
      expect(successWithCause.error.issues[0]?.message).toBe(
        "cause must be null for successful checks",
      );
    }

    for (const result of ["failure", "timeout"] as const) {
      const unsuccessfulWithoutCause = CheckRunSchema.safeParse({
        ...successfulRun,
        result,
        cause: null,
      });
      expect(unsuccessfulWithoutCause.success).toBe(false);
      if (!unsuccessfulWithoutCause.success) {
        expect(unsuccessfulWithoutCause.error.issues[0]?.path).toEqual(["cause"]);
        expect(unsuccessfulWithoutCause.error.issues[0]?.message).toBe(
          "cause is required for failed and timed out checks",
        );
      }
    }
  });
});

describe("check history contracts", () => {
  const monitoringError = {
    safeSummary: "Worker stopped before the request ran",
    recordedAt: terminalAt,
  } as const;

  it("validates safe monitoring errors with exact keys", () => {
    expect(MonitoringErrorSchema.parse({ ...monitoringError, safeSummary: "  safe message  " })).toEqual({
      ...monitoringError,
      safeSummary: "safe message",
    });
    expect(MonitoringErrorSchema.safeParse({ ...monitoringError, safeSummary: "" }).success).toBe(
      false,
    );
    expect(MonitoringErrorSchema.safeParse({ ...monitoringError, internalStack: "secret" }).success).toBe(
      false,
    );
  });

  it("accepts all three exact history branches", () => {
    const pending = { request: pendingRequest, run: null, monitoringError: null } as const;
    const completed = {
      request: completedRequest,
      run: successfulRun,
      monitoringError: null,
    } as const;
    const cancelled = {
      request: cancelledRequest,
      run: null,
      monitoringError,
    } as const;
    for (const item of [pending, completed, cancelled]) {
      expect(CheckHistoryItemSchema.parse(item)).toEqual(item);
      expect(CheckHistoryItemSchema.safeParse({ ...item, extra: true }).success).toBe(false);
    }
    expect(CompletedCheckHistoryItemSchema.parse(completed)).toEqual(completed);
  });

  it("rejects cross-status and nullability history mismatches", () => {
    for (const item of [
      { request: pendingRequest, run: successfulRun, monitoringError: null },
      { request: pendingRequest, run: null, monitoringError: monitoringError },
      { request: completedRequest, run: null, monitoringError: null },
      { request: completedRequest, run: successfulRun, monitoringError },
      { request: cancelledRequest, run: successfulRun, monitoringError },
      { request: cancelledRequest, run: null, monitoringError: null },
    ]) {
      expect(CheckHistoryItemSchema.safeParse(item).success).toBe(false);
    }
  });
});

describe("check list contracts", () => {
  it("inherits cursor pagination and accepts result and time filters", () => {
    expect(CheckListQuerySchema.parse({})).toEqual({ limit: 25 });
    expect(CheckListQuerySchema.parse({
      cursor: "next",
      limit: "100",
      result: "timeout",
      from: createdAt,
      to: terminalAt,
    })).toEqual({
      cursor: "next",
      limit: 100,
      result: "timeout",
      from: createdAt,
      to: terminalAt,
    });
  });

  it("rejects reversed ranges and unknown query keys with a useful path", () => {
    const result = CheckListQuerySchema.safeParse({ from: terminalAt, to: createdAt });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["to"]);
      expect(result.error.issues[0]?.message).toBe("to must be greater than or equal to from");
    }
    expect(CheckListQuerySchema.safeParse({ result: "unknown" }).success).toBe(false);
    expect(CheckListQuerySchema.safeParse({ extra: true }).success).toBe(false);
  });

  it("validates an exact paginated history response", () => {
    const response = {
      items: [{ request: completedRequest, run: successfulRun, monitoringError: null }],
      page: { nextCursor: null, hasMore: false },
    } as const;
    expect(CheckListResponseSchema.parse(response)).toEqual(response);
    expect(CheckListResponseSchema.safeParse({ ...response, extra: true }).success).toBe(false);
    expect(CheckListResponseSchema.safeParse({
      ...response,
      page: { ...response.page, extra: true },
    }).success).toBe(false);
  });
});
