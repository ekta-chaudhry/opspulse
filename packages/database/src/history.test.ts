import { describe, expect, it } from "vitest";
import type { QueryClient, QueryResult } from "./client.js";
import {
  InvalidHistoryCursorError,
  listIncidents,
  listMonitorChecks,
} from "./history.js";

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
    expect(pool.calls[0]?.values).toEqual([monitorId, 26]);
  });

  it("applies every check filter with parameterized SQL and permits the max limit", async () => {
    const pool = new FakeQueryClient([{ rows: [completedRow] }]);
    const from = "2026-07-01T00:00:00.000Z";
    const to = "2026-07-22T23:59:59.000Z";

    await listMonitorChecks(pool, monitorId, {
      result: "failure",
      from,
      to,
      limit: 100,
    });

    expect(pool.calls[0]?.text).toContain("r.result = $2");
    expect(pool.calls[0]?.text).toContain("cr.scheduled_at >= $3");
    expect(pool.calls[0]?.text).toContain("cr.scheduled_at <= $4");
    expect(pool.calls[0]?.values).toEqual([monitorId, "failure", from, to, 101]);
  });

  it("uses an opaque scheduled-at and UUID cursor without overlapping pages", async () => {
    const pool = new FakeQueryClient([
      { rows: [pendingRow, completedRow] },
      { rows: [completedRow] },
    ]);

    const first = await listMonitorChecks(pool, monitorId, { limit: 1 });
    expect(first.items.map(({ request }) => request.id)).toEqual([pendingRequestId]);
    expect(first.page.hasMore).toBe(true);
    expect(first.page.nextCursor).toBeTypeOf("string");

    const second = await listMonitorChecks(pool, monitorId, {
      cursor: first.page.nextCursor ?? "",
      limit: 1,
    });
    expect(second.items.map(({ request }) => request.id)).toEqual([requestId]);
    expect(pool.calls[1]?.text).toContain(
      "(cr.scheduled_at, cr.id) < ($2::timestamptz, $3::uuid)",
    );
    expect(pool.calls[1]?.values).toEqual([
      monitorId,
      "2026-07-22T10:01:00.000Z",
      pendingRequestId,
      2,
    ]);
  });

  it("lists filtered incidents newest first through the incident contract", async () => {
    const pool = new FakeQueryClient([{ rows: [incidentRow] }]);

    const page = await listIncidents(pool, {
      monitorId: monitorId.toUpperCase(),
      status: "open",
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-07-22T23:59:59.000Z",
      limit: 10,
    });

    expect(page.items[0]?.id).toBe(incidentId);
    expect(page.page).toEqual({ nextCursor: null, hasMore: false });
    expect(pool.calls[0]?.text).toContain("ORDER BY started_at DESC, id DESC");
    expect(pool.calls[0]?.text).toContain("started_at >= $3");
    expect(pool.calls[0]?.text).toContain("started_at <= $4");
    expect(pool.calls[0]?.values).toEqual([
      monitorId.toUpperCase(),
      "open",
      "2026-07-01T00:00:00.000Z",
      "2026-07-22T23:59:59.000Z",
      11,
    ]);
  });

  it("paginates incidents by started-at and UUID", async () => {
    const olderIncident = {
      ...incidentRow,
      id: "66666666-6666-4666-8666-666666666666",
      started_at: new Date("2026-07-21T10:00:00.000Z"),
    };
    const pool = new FakeQueryClient([
      { rows: [incidentRow, olderIncident] },
      { rows: [olderIncident] },
    ]);

    const first = await listIncidents(pool, { limit: 1 });
    const second = await listIncidents(pool, {
      cursor: first.page.nextCursor ?? "",
      limit: 1,
    });

    expect(first.items.map(({ id }) => id)).toEqual([incidentId]);
    expect(second.items.map(({ id }) => id)).toEqual([olderIncident.id]);
    expect(pool.calls[1]?.text).toContain(
      "(started_at, id) < ($1::timestamptz, $2::uuid)",
    );
    expect(pool.calls[1]?.values).toEqual([
      "2026-07-22T10:00:00.000Z",
      incidentId,
      2,
    ]);
  });

  it("rejects malformed cursors before querying", async () => {
    const pool = new FakeQueryClient([]);

    await expect(
      listMonitorChecks(pool, monitorId, { cursor: "abc", limit: 10 }),
    ).rejects.toBeInstanceOf(InvalidHistoryCursorError);
    await expect(
      listIncidents(pool, { cursor: "abc", limit: 10 }),
    ).rejects.toBeInstanceOf(InvalidHistoryCursorError);
    expect(pool.calls).toEqual([]);
  });

  it.each([0, 101, 1.5])("rejects an out-of-bounds history limit of %s", async (limit) => {
    const pool = new FakeQueryClient([]);

    await expect(listMonitorChecks(pool, monitorId, { limit })).rejects.toThrow();
    await expect(listIncidents(pool, { limit })).rejects.toThrow();
    expect(pool.calls).toEqual([]);
  });
});
