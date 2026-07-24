import {
  FailureCauseSchema,
  type PrivateHttpMonitor,
} from "@opspulse/contracts";
import type {
  HttpCheckOutcome,
  HttpCheckWorkItem,
} from "@opspulse/database";
import { describe, expect, it, vi } from "vitest";
import { checkHttpMonitor } from "./checker.js";
import {
  SafeHttpRequestAbortedError,
  type SafeHttpResult,
} from "./safe-client.js";

const monitor: PrivateHttpMonitor = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "http",
  name: "Public test target",
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
  nextSequence: 2,
  lastEvaluatedSequence: 0,
  lastEvaluatedCheckAt: null,
  activeIncident: null,
  notificationChannelIds: [],
  url: "https://example.test/health",
  method: "GET",
  timeoutSeconds: 5,
  acceptedStatus: { min: 200, max: 399 },
  headers: [{ name: "X-Probe", value: "opspulse" }],
  nextCheckAt: "2026-07-22T12:01:00.000Z",
  createdAt: "2026-07-22T12:00:00.000Z",
  updatedAt: "2026-07-22T12:00:00.000Z",
};

const workItem: HttpCheckWorkItem = {
  monitor,
  request: {
    id: "22222222-2222-4222-8222-222222222222",
    monitorId: monitor.id,
    generation: 0,
    sequence: 1,
    source: "http_schedule",
    status: "pending",
    scheduledAt: "2026-07-22T12:00:00.000Z",
    terminalAt: null,
    createdAt: "2026-07-22T12:00:00.000Z",
  },
};

async function run(result: SafeHttpResult): Promise<{
  execute: ReturnType<typeof vi.fn>;
  complete: ReturnType<typeof vi.fn>;
  outcome: HttpCheckOutcome;
}> {
  const execute = vi.fn(() => Promise.resolve(result));
  const complete = vi.fn((_requestId: string, outcome: HttpCheckOutcome) =>
    Promise.resolve(outcome),
  );
  await checkHttpMonitor(workItem, { execute, complete });
  const completed = complete.mock.calls[0];
  if (completed === undefined) throw new Error("completion was not called");
  return { execute, complete, outcome: completed[1] };
}

describe("checkHttpMonitor", () => {
  it("completes an accepted HTTP status as success", async () => {
    const { execute, complete, outcome } = await run({
      ok: true,
      status: 204,
      latencyMs: 12,
    });

    expect(execute).toHaveBeenCalledWith({
      url: monitor.url,
      method: monitor.method,
      timeoutMs: 5000,
      headers: monitor.headers,
    });
    expect(complete).toHaveBeenCalledWith(workItem.request.id, outcome);
    expect(outcome).toEqual({
      result: "success",
      httpStatus: 204,
      latencyMs: 12,
      cause: null,
    });
  });

  it("converts an unacceptable status to a contract-valid failure", async () => {
    const { outcome } = await run({ ok: true, status: 503, latencyMs: 20 });
    expect(outcome).toEqual({
      result: "failure",
      httpStatus: 503,
      latencyMs: 20,
      cause: {
        category: "http_status",
        code: "HTTP_STATUS",
        httpStatus: 503,
        safeSummary: "Target returned an unacceptable HTTP status",
      },
    });
    expect(FailureCauseSchema.parse(outcome.cause)).toEqual(outcome.cause);
  });

  it.each([
    ["timeout", "ETIMEDOUT", "timeout", "timeout"],
    ["dns", "ENOTFOUND", "failure", "dns"],
    ["connection", "ECONNREFUSED", "failure", "connection"],
    ["tls", "CERT_HAS_EXPIRED", "failure", "tls"],
    ["network", "ENETUNREACH", "failure", "network"],
    ["unknown", null, "failure", "unknown"],
  ] as const)("persists a safe %s failure", async (category, code, result, expectedCategory) => {
    const { outcome } = await run({
      ok: false,
      category,
      code,
      latencyMs: 9,
    });
    expect(outcome.result).toBe(result);
    expect(outcome.httpStatus).toBeNull();
    if (outcome.cause === null) throw new Error("failure cause was not persisted");
    expect(outcome.cause.category).toBe(expectedCategory);
    expect(outcome.cause.safeSummary).not.toContain(monitor.url);
    expect(FailureCauseSchema.parse(outcome.cause)).toEqual(outcome.cause);
  });

  it("classifies unexpected execution errors without leaking their message", async () => {
    const execute = vi.fn(() => Promise.reject(new Error("secret target detail")));
    const complete = vi.fn((_requestId: string, outcome: HttpCheckOutcome) =>
      Promise.resolve(outcome),
    );

    await checkHttpMonitor(workItem, { execute, complete });

    const outcome = complete.mock.calls[0]?.[1] as HttpCheckOutcome;
    if (outcome.cause === null) throw new Error("failure cause was not persisted");
    expect(outcome.cause.safeSummary).toBe("HTTP check failed unexpectedly");
    expect(JSON.stringify(outcome)).not.toContain("secret target detail");
  });

  it("leaves the request pending when shutdown cancels execution", async () => {
    const controller = new AbortController();
    const execute = vi.fn(() => Promise.reject(new SafeHttpRequestAbortedError()));
    const complete = vi.fn();
    controller.abort();

    await expect(
      checkHttpMonitor(workItem, { execute, complete }, controller.signal),
    ).resolves.toBeUndefined();

    expect(execute).toHaveBeenCalledWith({
      url: monitor.url,
      method: monitor.method,
      timeoutMs: 5000,
      headers: monitor.headers,
      signal: controller.signal,
    });
    expect(complete).not.toHaveBeenCalled();
  });
});
