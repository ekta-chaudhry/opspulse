import { describe, expect, it } from "vitest";
import {
  pgInt8ToSafeInteger,
  pgTimestampToIso,
  toCheckHistoryItem,
  toIncident,
  toPrivateHttpMonitor,
} from "./rows.js";

const monitorId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";
const incidentId = "44444444-4444-4444-8444-444444444444";
const now = new Date("2026-07-22T10:00:00.000Z");
const cause = {
  category: "connection",
  code: "ECONNREFUSED",
  httpStatus: null,
  safeSummary: "Connection refused",
};

const monitorRow = {
  id: monitorId,
  kind: "http",
  name: "API",
  state: "down",
  lifecycle: "active",
  published: false,
  interval_seconds: 60,
  failure_threshold: 1,
  recovery_threshold: 1,
  consecutive_failures: "1",
  consecutive_successes: "0",
  generation: "0",
  next_sequence: "2",
  last_evaluated_sequence: "1",
  last_evaluated_check_at: now,
  active_incident_id: incidentId,
  active_incident_status: "open",
  active_incident_started_at: now,
  active_incident_latest_cause: cause,
  url: "https://example.com/health",
  method: "GET",
  timeout_seconds: 5,
  accepted_status_min: 200,
  accepted_status_max: 399,
  headers: [{ name: "X-Probe", value: "opspulse" }],
  next_check_at: now,
  created_at: now,
  updated_at: now,
};

describe("PostgreSQL row conversion", () => {
  it("converts int8 strings only when they are safe integers", () => {
    expect(pgInt8ToSafeInteger("9007199254740991", "sequence")).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    expect(() =>
      pgInt8ToSafeInteger("9007199254740992", "sequence"),
    ).toThrow("sequence must be a safe int8 value");
    expect(() => pgInt8ToSafeInteger(1, "sequence")).toThrow(
      "sequence must be a safe int8 value",
    );
  });

  it("converts PostgreSQL dates and timestamp strings to canonical ISO", () => {
    expect(pgTimestampToIso(now, "created_at")).toBe("2026-07-22T10:00:00.000Z");
    expect(pgTimestampToIso("2026-07-22T15:30:00+05:30", "created_at")).toBe(
      "2026-07-22T10:00:00.000Z",
    );
    expect(() => pgTimestampToIso("not-a-date", "created_at")).toThrow(
      "created_at must be a valid PostgreSQL timestamp",
    );
  });

  it("maps an HTTP monitor and validates the private contract", () => {
    expect(toPrivateHttpMonitor(monitorRow)).toEqual({
      id: monitorId,
      kind: "http",
      name: "API",
      state: "down",
      lifecycle: "active",
      published: false,
      publicSlug: null,
      intervalSeconds: 60,
      failureThreshold: 1,
      recoveryThreshold: 1,
      consecutiveFailures: 1,
      consecutiveSuccesses: 0,
      generation: 0,
      nextSequence: 2,
      lastEvaluatedSequence: 1,
      lastEvaluatedCheckAt: "2026-07-22T10:00:00.000Z",
      activeIncident: {
        id: incidentId,
        status: "open",
        startedAt: "2026-07-22T10:00:00.000Z",
        latestCause: cause,
      },
      notificationChannelIds: [],
      url: "https://example.com/health",
      method: "GET",
      timeoutSeconds: 5,
      acceptedStatus: { min: 200, max: 399 },
      headers: [{ name: "X-Probe", value: "opspulse" }],
      nextCheckAt: "2026-07-22T10:00:00.000Z",
      createdAt: "2026-07-22T10:00:00.000Z",
      updatedAt: "2026-07-22T10:00:00.000Z",
    });
  });

  it("parses completed history causes through the failure-cause contract", () => {
    const history = toCheckHistoryItem({
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
    });

    expect(history.run?.cause).toEqual(cause);
    expect(() =>
      toCheckHistoryItem({
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
        run_cause: { ...cause, category: "invalid" },
        run_completed_at: now,
        run_created_at: now,
        run_evaluated_at: now,
      }),
    ).toThrow();
  });

  it("maps incident JSON causes and timestamps through the incident contract", () => {
    expect(
      toIncident({
        id: incidentId,
        monitor_id: monitorId,
        monitor_name: "API",
        status: "resolved",
        started_at: now,
        resolved_at: new Date("2026-07-22T10:01:00.000Z"),
        opening_cause: cause,
        latest_cause: cause,
        resolution_reason: "recovered",
      }),
    ).toEqual({
      id: incidentId,
      monitorId,
      monitorName: "API",
      status: "resolved",
      startedAt: "2026-07-22T10:00:00.000Z",
      resolvedAt: "2026-07-22T10:01:00.000Z",
      openingCause: cause,
      latestCause: cause,
      resolutionReason: "recovered",
    });
  });
});
