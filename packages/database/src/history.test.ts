import { describe, expect, it } from "vitest";
import type { QueryClient, QueryResult } from "./client.js";
import { listIncidents, listMonitorChecks } from "./history.js";

const monitorId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const pendingRequestId = "55555555-5555-4555-8555-555555555555";
const runId = "33333333-3333-4333-8333-333333333333";
const incidentId = "44444444-4444-4444-8444-444444444444";
const now = new Date("2026-07-22T10:00:00.000Z");
const cause = {
  category: "connection",
  code: "ECONNREFUSED",
  httpStatus: null,
  safeSummary: "Connection refused",
};

class FakeQueryClient implements QueryClient {
  readonly calls: { text: string; values?: unknown[] }[] = [];

  constructor(private readonly results: QueryResult[]) {}

  query(text: string, values?: unknown[]): Promise<QueryResult> {
    this.calls.push(values === undefined ? { text } : { text, values });
    const result = this.results.shift();
    if (result === undefined) throw new Error("Unexpected query");
    return Promise.resolve(result);
  }
}

const completedRow = {
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
  run_result: "failure",
  run_http_status: null,
  run_latency_ms: "12",
  run_cause: cause,
  run_completed_at: now,
  run_created_at: now,
  run_evaluated_at: now,
};

const pendingRow = {
  request_id: pendingRequestId,
  request_monitor_id: monitorId,
  request_generation: "0",
  request_sequence: "2",
  request_source: "http_schedule",
  request_status: "pending",
  request_scheduled_at: new Date("2026-07-22T10:01:00.000Z"),
  request_terminal_at: null,
  request_created_at: new Date("2026-07-22T10:01:00.000Z"),
  run_id: null,
  run_result: null,
  run_http_status: null,
  run_latency_ms: null,
  run_cause: null,
  run_completed_at: null,
  run_created_at: null,
  run_evaluated_at: null,
};

const incidentRow = {
  id: incidentId,
  monitor_id: monitorId,
  monitor_name: "API",
  status: "open",
  started_at: now,
  resolved_at: null,
  opening_cause: cause,
  latest_cause: cause,
  resolution_reason: null,
};

describe("monitor and incident history", () => {
  it("lists contract-valid monitor checks newest first with a bounded limit", async () => {
    const pool = new FakeQueryClient([{ rows: [pendingRow, completedRow] }]);

    const page = await listMonitorChecks(pool, monitorId, { limit: 25 });

    expect(page.items.map(({ request }) => request.id)).toEqual([
      pendingRequestId,
      requestId,
    ]);
    expect(page.page).toEqual({ nextCursor: null, hasMore: false });
    expect(pool.calls[0]?.text).toContain("ORDER BY cr.scheduled_at DESC, cr.id DESC");
    expect(pool.calls[0]?.values).toEqual([monitorId, 25]);
  });

  it("lists filtered incidents newest first through the incident contract", async () => {
    const pool = new FakeQueryClient([{ rows: [incidentRow] }]);

    const page = await listIncidents(pool, {
      monitorId: monitorId.toUpperCase(),
      status: "open",
      limit: 10,
    });

    expect(page.items[0]?.id).toBe(incidentId);
    expect(page.page).toEqual({ nextCursor: null, hasMore: false });
    expect(pool.calls[0]?.text).toContain("ORDER BY started_at DESC, id DESC");
    expect(pool.calls[0]?.values).toEqual([monitorId.toUpperCase(), "open", 10]);
  });

  it.each([0, 101, 1.5])("rejects an out-of-bounds history limit of %s", async (limit) => {
    const pool = new FakeQueryClient([]);

    await expect(listMonitorChecks(pool, monitorId, { limit })).rejects.toThrow();
    await expect(listIncidents(pool, { limit })).rejects.toThrow();
    expect(pool.calls).toEqual([]);
  });
});
