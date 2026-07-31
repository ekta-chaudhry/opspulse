import { describe, expect, it } from "vitest";
import type {
  TransactionClient,
  TransactionPool,
  TransactionQueryResult,
} from "./transaction.js";
import { completeHttpCheck } from "./evaluate-monitor.js";

const monitorId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";
const incidentId = "44444444-4444-4444-8444-444444444444";
const openedEventId = "55555555-5555-4555-8555-555555555555";
const recoveryEventId = "66666666-6666-4666-8666-666666666666";
const resolvedEventId = "77777777-7777-4777-8777-777777777777";
const now = new Date("2026-07-22T10:00:00.000Z");
const cause = {
  category: "connection",
  code: "ECONNREFUSED",
  httpStatus: null,
  safeSummary: "Connection refused",
} as const;

const requestRow = (overrides: Record<string, unknown> = {}) => ({
  id: requestId,
  monitor_id: monitorId,
  generation: "0",
  sequence: "1",
  source: "http_schedule",
  status: "pending",
  scheduled_at: now,
  terminal_at: null,
  created_at: now,
  claim_started_at: now,
  claim_count: "2",
  ...overrides,
});

const monitorRow = (overrides: Record<string, unknown> = {}) => ({
  id: monitorId,
  kind: "http",
  name: "API",
  state: "up",
  lifecycle: "active",
  published: false,
  interval_seconds: 60,
  failure_threshold: 1,
  recovery_threshold: 1,
  consecutive_failures: "0",
  consecutive_successes: "1",
  generation: "0",
  next_sequence: "2",
  last_evaluated_sequence: "0",
  last_evaluated_check_at: null,
  active_incident_id: null,
  url: "https://example.com/health",
  method: "GET",
  timeout_seconds: 5,
  accepted_status_min: 200,
  accepted_status_max: 399,
  headers: [],
  next_check_at: now,
  created_at: now,
  updated_at: now,
  ...overrides,
});

const completedProjection = (
  result: "success" | "failure" | "timeout",
  overrides: Record<string, unknown> = {},
) => ({
  request_id: requestId,
  request_monitor_id: monitorId,
  request_generation: "0",
  request_sequence: "1",
  request_source: "http_schedule",
  request_status: "completed",
  request_scheduled_at: now,
  request_terminal_at: now,
  request_created_at: now,
  run_id: runId,
  run_result: result,
  run_http_status: result === "success" ? 204 : null,
  run_latency_ms: "12",
  run_cause: result === "success" ? null : cause,
  run_completed_at: now,
  run_created_at: now,
  run_evaluated_at: now,
  ...overrides,
});

type QueryStep = TransactionQueryResult | Error;

class FakeTransactionClient implements TransactionClient {
  readonly calls: { text: string; values?: unknown[] }[] = [];
  released = false;

  constructor(private readonly steps: QueryStep[]) {}

  query(text: string, values?: unknown[]): Promise<TransactionQueryResult> {
    this.calls.push(values === undefined ? { text } : { text, values });
    const step = this.steps.shift();
    if (step === undefined) throw new Error(`Unexpected query: ${text}`);
    return step instanceof Error ? Promise.reject(step) : Promise.resolve(step);
  }

  release(): void {
    this.released = true;
  }
}

const poolFor = (client: FakeTransactionClient): TransactionPool => ({
  connect: () => Promise.resolve(client),
});

describe("HTTP check completion", () => {
  it("completes a reclaimed threshold-one failure with one run and incident", async () => {
    const incidentRow = {
      id: incidentId,
      status: "open",
      started_at: now,
      latest_cause: cause,
    };
    const client = new FakeTransactionClient([
      { rows: [] },
      { rows: [monitorRow()] },
      { rows: [requestRow()] },
      { rows: [{ id: runId }] },
      { rows: [] },
      { rows: [incidentRow] },
      { rows: [{ id: openedEventId }] },
      { rows: [] },
      { rows: [] },
      { rows: [completedProjection("failure")] },
      { rows: [] },
    ]);

    const completed = await completeHttpCheck(
      poolFor(client),
      requestId,
      { result: "failure", httpStatus: null, latencyMs: 12, cause },
      now,
    );

    expect(completed.historyItem.run?.result).toBe("failure");
    expect(completed.incident).toEqual({
      id: incidentId,
      status: "open",
      startedAt: "2026-07-22T10:00:00.000Z",
      latestCause: cause,
    });
    expect(client.calls.map(({ text }) => text)).toEqual([
      "BEGIN",
      expect.stringContaining("FOR UPDATE OF m"),
      expect.stringContaining("FROM check_requests"),
      expect.stringContaining("INSERT INTO check_runs"),
      expect.stringContaining("UPDATE check_requests"),
      expect.stringContaining("INSERT INTO incidents"),
      expect.stringContaining("INSERT INTO incident_events"),
      expect.stringContaining("FROM monitor_notification_channels"),
      expect.stringContaining("UPDATE monitors"),
      expect.stringContaining("FROM check_requests cr"),
      "COMMIT",
    ]);
    expect(client.calls[1]?.text).toContain("FOR UPDATE OF m");
    expect(client.calls[1]?.values).toEqual([requestId]);
    expect(client.calls[5]?.values).toEqual([
      monitorId,
      "API",
      now,
      JSON.stringify(cause),
    ]);
    expect(client.calls[6]?.values).toEqual([
      incidentId,
      "opened",
      now,
      JSON.stringify({ cause }),
    ]);
    expect(client.calls[8]?.values).toEqual([
      monitorId,
      "down",
      "1",
      "0",
      "1",
      now,
      incidentId,
    ]);
    expect(client.calls.filter(({ text }) => text.includes("INSERT INTO check_runs"))).toHaveLength(
      1,
    );
    expect(client.calls.filter(({ text }) => text.includes("INSERT INTO incidents"))).toHaveLength(
      1,
    );
  });

  it("records recovery and resolves the active incident atomically", async () => {
    const recoveringRequest = requestRow({ sequence: "2" });
    const recoveringMonitor = monitorRow({
      state: "down",
      next_sequence: "3",
      last_evaluated_sequence: "1",
      consecutive_failures: "1",
      consecutive_successes: "0",
      active_incident_id: incidentId,
      active_incident_status: "open",
      active_incident_started_at: now,
      active_incident_latest_cause: cause,
    });
    const client = new FakeTransactionClient([
      { rows: [] },
      { rows: [recoveringMonitor] },
      { rows: [recoveringRequest] },
      { rows: [{ id: runId }] },
      { rows: [] },
      { rows: [{ id: recoveryEventId }] },
      { rows: [] },
      { rows: [{ id: resolvedEventId }] },
      { rows: [] },
      { rows: [] },
      {
        rows: [completedProjection("success", {
          request_sequence: "2",
          run_sequence: "2",
        })],
      },
      { rows: [] },
    ]);

    const completed = await completeHttpCheck(
      poolFor(client),
      requestId,
      { result: "success", httpStatus: 204, latencyMs: 12, cause: null },
      now,
    );

    expect(completed.incident).toBeNull();
    expect(client.calls[5]?.values).toEqual([
      incidentId,
      "recovery_observed",
      now,
      JSON.stringify({ consecutiveSuccesses: 1, recoveryThreshold: 1 }),
    ]);
    expect(client.calls[6]?.text).toContain("UPDATE incidents");
    expect(client.calls[6]?.values).toEqual([incidentId, now]);
    expect(client.calls[7]?.values).toEqual([
      incidentId,
      "resolved",
      now,
      JSON.stringify({ reason: "recovered" }),
    ]);
    expect(client.calls[8]?.text).toContain("FROM monitor_notification_channels");
    expect(client.calls[9]?.values).toEqual([
      monitorId,
      "up",
      "0",
      "0",
      "2",
      now,
      null,
    ]);
  });

  it("returns the existing projection without creating another run or incident", async () => {
    const client = new FakeTransactionClient([
      { rows: [] },
      { rows: [monitorRow()] },
      { rows: [requestRow({ status: "completed", terminal_at: now })] },
      { rows: [completedProjection("failure")] },
      { rows: [] },
      { rows: [] },
    ]);

    const completed = await completeHttpCheck(
      poolFor(client),
      requestId.toUpperCase(),
      { result: "success", httpStatus: 204, latencyMs: 1, cause: null },
      now,
    );

    expect(completed.historyItem.run?.id).toBe(runId);
    expect(completed.incident).toBeNull();
    expect(client.calls.map(({ text }) => text)).toEqual([
      "BEGIN",
      expect.stringContaining("FOR UPDATE OF m"),
      expect.stringContaining("FROM check_requests"),
      expect.stringContaining("FROM check_requests cr"),
      expect.stringContaining("FROM incidents i"),
      "COMMIT",
    ]);
    expect(client.calls.some(({ text }) => /^\s*(?:INSERT|UPDATE)\b/u.test(text))).toBe(false);
  });

  it("retains a late result for a cancelled request without evaluating it", async () => {
    const client = new FakeTransactionClient([
      { rows: [] },
      { rows: [monitorRow()] },
      {
        rows: [requestRow({
          status: "cancelled-internal",
          terminal_at: now,
        })],
      },
      { rows: [{ id: runId }] },
      { rows: [] },
      { rows: [] },
    ]);

    const result = await completeHttpCheck(
      poolFor(client),
      requestId,
      { result: "success", httpStatus: 204, latencyMs: 1, cause: null },
      now,
    );

    expect(result.historyItem.request.status).toBe("cancelled-internal");
    expect(client.calls[3]?.text).toContain("INSERT INTO check_runs");
    expect(client.calls[3]?.values?.[0]).toBeNull();
    expect(client.calls.at(-1)?.text).toBe("COMMIT");
  });
});
