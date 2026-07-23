import type { HttpMonitorInput } from "@opspulse/contracts";
import { describe, expect, it } from "vitest";
import type { QueryClient, QueryResult } from "./client.js";
import type {
  TransactionClient,
  TransactionPool,
  TransactionQueryResult,
} from "./transaction.js";
import {
  archiveMonitor,
  createHttpMonitor,
  getHttpMonitor,
  getMonitor,
  listMonitors,
  MonitorLifecycleConflictError,
  pauseMonitor,
  resumeMonitor,
} from "./monitors.js";

const monitorId = "11111111-1111-4111-8111-111111111111";
const now = new Date("2026-07-22T10:00:00.000Z");

const input: HttpMonitorInput = {
  kind: "http",
  name: "API",
  published: false,
  intervalSeconds: 60,
  failureThreshold: 2,
  recoveryThreshold: 1,
  url: "https://example.com/health",
  method: "GET",
  timeoutSeconds: 5,
  acceptedStatus: { min: 200, max: 399 },
  headers: [],
};

const row = {
  id: monitorId,
  kind: "http",
  name: "API",
  state: "pending",
  lifecycle: "active",
  published: false,
  interval_seconds: 60,
  failure_threshold: 2,
  recovery_threshold: 1,
  consecutive_failures: "0",
  consecutive_successes: "0",
  generation: "0",
  next_sequence: "1",
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
  cursor_created_at: "2026-07-22T10:00:00.123456Z",
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

class FakeTransactionClient implements TransactionClient {
  readonly calls: { text: string; values?: unknown[] }[] = [];
  released = false;

  constructor(private readonly results: TransactionQueryResult[]) {}

  query(text: string, values?: unknown[]): Promise<TransactionQueryResult> {
    this.calls.push(values === undefined ? { text } : { text, values });
    const result = this.results.shift();
    if (result === undefined) throw new Error("Unexpected transaction query");
    return Promise.resolve(result);
  }

  release(): void {
    this.released = true;
  }
}

class FakeTransactionPool implements TransactionPool {
  constructor(readonly client: FakeTransactionClient) {}

  connect(): Promise<TransactionClient> {
    return Promise.resolve(this.client);
  }
}

const transactionFor = (...rows: unknown[][]): FakeTransactionPool =>
  new FakeTransactionPool(new FakeTransactionClient(rows.map((resultRows) => ({
    rows: resultRows,
  }))));

describe("HTTP monitor persistence", () => {
  it("creates an immediately due HTTP monitor with a database-generated UUID", async () => {
    const pool = new FakeQueryClient([{ rows: [row] }]);

    const monitor = await createHttpMonitor(pool, input, now);

    expect(monitor.id).toBe(monitorId);
    expect(monitor.nextCheckAt).toBe("2026-07-22T10:00:00.000Z");
    expect(pool.calls).toHaveLength(1);
    expect(pool.calls[0]?.text).toMatch(/^INSERT INTO monitors/u);
    expect(pool.calls[0]?.text).not.toMatch(/INSERT INTO monitors\s*\(\s*id/u);
    expect(pool.calls[0]?.values).toEqual([
      "http",
      "API",
      false,
      60,
      2,
      1,
      "https://example.com/health",
      "GET",
      5,
      200,
      399,
      JSON.stringify([]),
      now,
    ]);
  });

  it("loads an HTTP monitor and its active incident projection by UUID", async () => {
    const pool = new FakeQueryClient([{ rows: [row] }]);

    const monitor = await getHttpMonitor(pool, monitorId);

    expect(monitor?.id).toBe(monitorId);
    expect(pool.calls[0]?.text).toContain("LEFT JOIN incidents");
    expect(pool.calls[0]?.values).toEqual([monitorId]);
  });

  it("returns null when the monitor does not exist", async () => {
    const pool = new FakeQueryClient([{ rows: [] }]);

    await expect(getHttpMonitor(pool, monitorId)).resolves.toBeNull();
  });

  it("loads any non-archived monitor by UUID", async () => {
    const pool = new FakeQueryClient([{ rows: [row] }]);

    await expect(getMonitor(pool, monitorId)).resolves.toMatchObject({ id: monitorId });
    expect(pool.calls[0]?.text).toContain("m.lifecycle <> 'archived'");
  });

  it("lists filtered monitors newest first with cursor pagination", async () => {
    const olderRow = {
      ...row,
      id: "22222222-2222-4222-8222-222222222222",
      created_at: new Date("2026-07-21T10:00:00.000Z"),
      updated_at: new Date("2026-07-21T10:00:00.000Z"),
    };
    const pool = new FakeQueryClient([
      { rows: [row, olderRow] },
      { rows: [olderRow] },
    ]);

    const first = await listMonitors(pool, {
      kind: "http",
      state: "pending",
      lifecycle: "active",
      published: false,
      limit: 1,
    });
    const second = await listMonitors(pool, {
      cursor: first.page.nextCursor ?? "",
      limit: 1,
    });

    expect(first.items.map(({ id }) => id)).toEqual([monitorId]);
    expect(first.page.hasMore).toBe(true);
    expect(second.items.map(({ id }) => id)).toEqual([olderRow.id]);
    expect(pool.calls[0]?.text).toContain("m.kind = $1");
    expect(pool.calls[0]?.text).toContain("m.state = $2");
    expect(pool.calls[0]?.text).toContain("m.lifecycle = $3");
    expect(pool.calls[0]?.text).toContain("m.published = $4");
    expect(pool.calls[0]?.text).toContain("AS cursor_created_at");
    expect(pool.calls[0]?.text).toContain("ORDER BY m.created_at DESC, m.id DESC");
    expect(pool.calls[0]?.values).toEqual(["http", "pending", "active", false, 2]);
    expect(pool.calls[1]?.text).toContain(
      "(m.created_at, m.id) < ($1::timestamptz, $2::uuid)",
    );
    expect(pool.calls[1]?.values).toEqual([
      "2026-07-22T10:00:00.123456Z",
      monitorId,
      2,
    ]);
  });

  it("lists heartbeat rows without narrowing the monitor list contract", async () => {
    const pool = new FakeQueryClient([{ rows: [{
      ...row,
      kind: "heartbeat",
      url: null,
      method: null,
      timeout_seconds: null,
      accepted_status_min: null,
      accepted_status_max: null,
      headers: null,
      next_check_at: null,
      grace_period_seconds: 60,
      last_heartbeat_at: null,
      next_heartbeat_deadline: null,
    }] }]);

    const page = await listMonitors(pool, { kind: "heartbeat", limit: 25 });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.kind).toBe("heartbeat");
  });

  it("pauses an active monitor and invalidates pending generation work", async () => {
    const pausedRow = {
      ...row,
      lifecycle: "paused",
      generation: "1",
      next_sequence: "1",
      last_evaluated_sequence: "0",
      next_check_at: null,
      updated_at: new Date("2026-07-22T10:05:00.000Z"),
    };
    const pool = transactionFor([], [], [row], [], [], [pausedRow], []);

    const monitor = await pauseMonitor(
      pool,
      monitorId,
      new Date("2026-07-22T10:05:00.000Z"),
    );

    expect(monitor.lifecycle).toBe("paused");
    const requestLockIndex = pool.client.calls.findIndex(({ text }) =>
      text.includes("FROM check_requests") && text.includes("FOR UPDATE")
    );
    const monitorLockIndex = pool.client.calls.findIndex(({ text }) =>
      text.includes("FROM monitors m") && text.includes("FOR UPDATE OF m")
    );
    expect(requestLockIndex).toBeGreaterThan(0);
    expect(requestLockIndex).toBeLessThan(monitorLockIndex);
    expect(pool.client.calls.some(({ text }) =>
      text.includes("SET status = 'cancelled-internal'")
    )).toBe(true);
    expect(pool.client.calls.some(({ text }) =>
      text.includes("lifecycle = 'paused'") && text.includes("generation = generation + 1")
    )).toBe(true);
    expect(pool.client.released).toBe(true);
  });

  it("resumes a paused monitor pending with fresh due work", async () => {
    const pausedRow = { ...row, lifecycle: "paused", next_check_at: null };
    const resumedAt = new Date("2026-07-22T10:05:00.000Z");
    const resumedRow = {
      ...row,
      state: "pending",
      generation: "1",
      next_sequence: "1",
      last_evaluated_sequence: "0",
      next_check_at: resumedAt,
      updated_at: resumedAt,
    };
    const pool = transactionFor([], [], [pausedRow], [], [], [resumedRow], []);

    const monitor = await resumeMonitor(pool, monitorId, resumedAt);

    expect(monitor).toMatchObject({ lifecycle: "active", state: "pending" });
    expect(pool.client.calls.some(({ text }) =>
      text.includes("lifecycle = 'active'") && text.includes("next_check_at = $2")
    )).toBe(true);
  });

  it("archives a monitor and resolves its open incident in the same transaction", async () => {
    const incidentId = "33333333-3333-4333-8333-333333333333";
    const cause = {
      category: "dns",
      code: "ENOTFOUND",
      httpStatus: null,
      safeSummary: "Target hostname could not be resolved",
    };
    const openRow = {
      ...row,
      state: "down",
      active_incident_id: incidentId,
      active_incident_status: "open",
      active_incident_started_at: now,
      active_incident_latest_cause: cause,
    };
    const archivedAt = new Date("2026-07-22T10:05:00.000Z");
    const archivedRow = {
      ...openRow,
      lifecycle: "archived",
      published: false,
      generation: "1",
      next_sequence: "1",
      last_evaluated_sequence: "0",
      active_incident_id: null,
      next_check_at: null,
      updated_at: archivedAt,
    };
    const pool = transactionFor([], [], [openRow], [], [], [], [], [archivedRow], []);

    const monitor = await archiveMonitor(pool, monitorId, archivedAt);

    expect(monitor).toMatchObject({ lifecycle: "archived", activeIncident: null });
    expect(pool.client.calls.some(({ text, values }) =>
      text.includes("resolution_reason = 'monitor_archived'") && values?.[0] === incidentId
    )).toBe(true);
    expect(pool.client.calls.some(({ text }) =>
      text.includes("INSERT INTO incident_events") && text.includes("'resolved'")
    )).toBe(true);
  });

  it("rejects invalid lifecycle transitions without mutating the monitor", async () => {
    const pool = transactionFor([], [], [{ ...row, lifecycle: "paused" }], []);

    await expect(pauseMonitor(pool, monitorId, now)).rejects.toBeInstanceOf(
      MonitorLifecycleConflictError,
    );
    expect(pool.client.calls.some(({ text }) => text.startsWith("UPDATE monitors"))).toBe(false);
  });
});
