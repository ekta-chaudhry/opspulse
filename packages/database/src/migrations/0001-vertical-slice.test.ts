import { expect, it } from "vitest";
import { verticalSliceMigrationSql } from "./0001-vertical-slice.js";

const normalizedSql = verticalSliceMigrationSql.replaceAll(/\s+/g, " ");

it("creates the reduced vertical-slice tables in dependency order", () => {
  const expectedTables = [
    "monitors",
    "check_requests",
    "check_runs",
    "incidents",
    "incident_events",
  ];

  const positions = expectedTables.map((table) =>
    normalizedSql.indexOf(`CREATE TABLE ${table}`));
  expect(positions.every((position) => position >= 0)).toBe(true);
  expect(positions).toEqual([...positions].sort((left, right) => left - right));
  expect(normalizedSql).not.toContain("IF NOT EXISTS");
});

it("uses PostgreSQL-native identifiers, timestamps, and JSON storage", () => {
  expect(normalizedSql).toContain("id UUID DEFAULT gen_random_uuid() NOT NULL");
  expect(normalizedSql).toContain('CONSTRAINT "monitors_pkey" PRIMARY KEY (id)');
  expect(normalizedSql.match(/TIMESTAMPTZ/g)?.length).toBeGreaterThanOrEqual(10);
  expect(normalizedSql).toContain("headers JSONB");
  expect(normalizedSql).toContain("cause JSONB");
  expect(normalizedSql).toContain("opening_cause JSONB");
  expect(normalizedSql).toContain("details JSONB");
});

it("constrains monitor ranges, sequencing, and subtype columns", () => {
  expect(normalizedSql).toContain('CONSTRAINT "monitors_interval_seconds_check" CHECK');
  expect(normalizedSql).toContain('CONSTRAINT "monitors_thresholds_check" CHECK');
  expect(normalizedSql).toContain('CONSTRAINT "monitors_counters_check" CHECK');
  expect(normalizedSql).toContain('CONSTRAINT "monitors_sequence_order_check" CHECK');
  expect(normalizedSql).toContain('CONSTRAINT "monitors_http_status_range_check" CHECK');
  expect(normalizedSql).toContain('CONSTRAINT "monitors_subtype_check" CHECK');
  expect(normalizedSql).toContain("kind IN ('http', 'heartbeat')");
  expect(normalizedSql).toContain("method IS NOT NULL AND method IN ('GET', 'HEAD')");
  expect(normalizedSql).toContain(
    "timeout_seconds IS NOT NULL AND timeout_seconds BETWEEN 1 AND 30",
  );
  expect(normalizedSql).toContain(
    "grace_period_seconds IS NOT NULL AND grace_period_seconds BETWEEN 0 AND 86400",
  );
});

it("enforces check request terminal state and pending uniqueness", () => {
  expect(normalizedSql).toContain('CONSTRAINT "check_requests_status_terminal_check" CHECK');
  expect(normalizedSql).toContain("UNIQUE (monitor_id, generation, sequence)");
  expect(normalizedSql).toContain(
    "CREATE UNIQUE INDEX check_requests_one_pending_per_monitor_idx",
  );
  expect(normalizedSql).toContain("WHERE status = 'pending'");
  expect(normalizedSql).toContain("CREATE INDEX check_requests_due_idx");
  expect(normalizedSql).toContain("CREATE INDEX check_requests_history_idx");
});

it("enforces check run result contracts and history access", () => {
  expect(normalizedSql).toContain(
    'CONSTRAINT "check_runs_request_id_key" UNIQUE (request_id)',
  );
  expect(normalizedSql).toContain('CONSTRAINT "check_runs_result_cause_check" CHECK');
  expect(normalizedSql).toContain('CONSTRAINT "check_runs_http_status_check" CHECK');
  expect(normalizedSql).toContain('CONSTRAINT "check_runs_latency_check" CHECK');
  expect(normalizedSql).toContain('CONSTRAINT "check_runs_evaluated_at_check" CHECK');
  expect(normalizedSql).toContain(
    "http_status IS NOT NULL AND http_status = (cause->>'httpStatus')::INTEGER",
  );
  expect(normalizedSql).toContain("CREATE INDEX check_runs_history_idx");
});

it("enforces incident lifecycle, one open incident, and timeline access", () => {
  expect(normalizedSql).toContain('CONSTRAINT "incidents_status_times_check" CHECK');
  expect(normalizedSql).toContain(
    "resolution_reason IS NOT NULL AND resolution_reason IN ('recovered', 'monitor_archived')",
  );
  expect(normalizedSql).toContain("CREATE UNIQUE INDEX incidents_one_open_per_monitor_idx");
  expect(normalizedSql).toContain("WHERE status = 'open'");
  expect(normalizedSql).toContain("CREATE INDEX incidents_history_idx");
  expect(normalizedSql).toContain('CONSTRAINT "incident_events_type_check" CHECK');
  expect(normalizedSql).toContain("CREATE INDEX incident_events_timeline_idx");
});

it("adds the deferred active incident relationship only after incidents exist", () => {
  const incidentsPosition = normalizedSql.indexOf("CREATE TABLE incidents");
  const relationshipPosition = normalizedSql.indexOf(
    "ADD CONSTRAINT \"monitors_active_incident_id_fkey\"",
  );

  expect(relationshipPosition).toBeGreaterThan(incidentsPosition);
  expect(normalizedSql).toContain(
    "FOREIGN KEY (active_incident_id) REFERENCES incidents(id) DEFERRABLE INITIALLY DEFERRED",
  );
});
