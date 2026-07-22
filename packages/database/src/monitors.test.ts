import type { HttpMonitorInput } from "@opspulse/contracts";
import { describe, expect, it } from "vitest";
import type { QueryClient, QueryResult } from "./client.js";
import { createHttpMonitor, getHttpMonitor } from "./monitors.js";

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
});
