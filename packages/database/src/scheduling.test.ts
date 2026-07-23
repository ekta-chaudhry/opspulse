import { describe, expect, it } from "vitest";
import type {
  TransactionClient,
  TransactionPool,
  TransactionQueryResult,
} from "./transaction.js";
import { claimDueHttpCheck } from "./scheduling.js";

const monitorId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const now = new Date("2026-07-22T10:00:00.000Z");

const monitorRow = {
  id: monitorId,
  kind: "http",
  name: "API",
  state: "up",
  lifecycle: "active",
  published: false,
  interval_seconds: 60,
  failure_threshold: 2,
  recovery_threshold: 1,
  consecutive_failures: "0",
  consecutive_successes: "1",
  generation: "0",
  next_sequence: "2",
  last_evaluated_sequence: "1",
  last_evaluated_check_at: now,
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

const requestRow = {
  id: requestId,
  monitor_id: monitorId,
  generation: "0",
  sequence: "2",
  source: "http_schedule",
  status: "pending",
  scheduled_at: now,
  terminal_at: null,
  created_at: now,
};

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

describe("HTTP check scheduling", () => {
  it("locks one due monitor, advances it, and persists a pending request atomically", async () => {
    const client = new FakeTransactionClient([
      { rows: [] },
      { rows: [monitorRow] },
      { rows: [] },
      { rows: [requestRow] },
      { rows: [] },
    ]);

    const work = await claimDueHttpCheck(poolFor(client), now);

    expect(work?.request).toEqual({
      id: requestId,
      monitorId,
      generation: 0,
      sequence: 2,
      source: "http_schedule",
      status: "pending",
      scheduledAt: "2026-07-22T10:00:00.000Z",
      terminalAt: null,
      createdAt: "2026-07-22T10:00:00.000Z",
    });
    expect(work?.monitor.id).toBe(monitorId);
    expect(work?.monitor.kind).toBe("http");
    expect(client.calls.map(({ text }) => text)).toEqual([
      "BEGIN",
      expect.stringContaining("FOR UPDATE OF m SKIP LOCKED"),
      expect.stringContaining("UPDATE monitors"),
      expect.stringContaining("INSERT INTO check_requests"),
      "COMMIT",
    ]);
    expect(client.calls[1]?.text).toContain("NOT EXISTS");
    expect(client.calls[1]?.text).toContain("cr.status = 'pending'");
    expect(client.calls[1]?.values).toEqual([now]);
    expect(client.calls[2]?.text).toContain("$2::timestamptz");
    expect(client.calls[2]?.values).toEqual([monitorId, now]);
    expect(client.calls[3]?.values).toEqual([monitorId, "0", "2", now]);
    expect(client.released).toBe(true);
  });

  it("returns null without writes when no monitor is due", async () => {
    const client = new FakeTransactionClient([
      { rows: [] },
      { rows: [] },
      { rows: [] },
    ]);

    await expect(claimDueHttpCheck(poolFor(client), now)).resolves.toBeNull();
    expect(client.calls.map(({ text }) => text)).toEqual([
      "BEGIN",
      expect.stringContaining("FOR UPDATE OF m SKIP LOCKED"),
      "COMMIT",
    ]);
  });

  it("rolls back when pending request persistence fails", async () => {
    const failure = new Error("insert failed");
    const client = new FakeTransactionClient([
      { rows: [] },
      { rows: [monitorRow] },
      { rows: [] },
      failure,
      { rows: [] },
    ]);

    await expect(claimDueHttpCheck(poolFor(client), now)).rejects.toBe(failure);
    expect(client.calls.at(-1)?.text).toBe("ROLLBACK");
    expect(client.released).toBe(true);
  });
});
