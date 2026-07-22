import {
  CheckHistoryItemSchema,
  CheckRequestSchema,
  FailureCauseSchema,
  IncidentSchema,
  IncidentSummarySchema,
  PrivateHttpMonitorSchema,
  type CheckHistoryItem,
  type CheckRequest,
  type FailureCause,
  type Incident,
  type IncidentSummary,
  type PrivateHttpMonitor,
} from "@opspulse/contracts";

type PgRow = Record<string, unknown>;

function asRow(value: unknown): PgRow {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("PostgreSQL row must be an object");
  }
  return value as PgRow;
}

function requiredString(row: PgRow, column: string): string {
  const value = row[column];
  if (typeof value !== "string") {
    throw new TypeError(`${column} must be a string`);
  }
  return value;
}

function requiredBoolean(row: PgRow, column: string): boolean {
  const value = row[column];
  if (typeof value !== "boolean") {
    throw new TypeError(`${column} must be a boolean`);
  }
  return value;
}

function requiredInteger(row: PgRow, column: string): number {
  const value = row[column];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new TypeError(`${column} must be a safe integer`);
  }
  return value;
}

function nullableInteger(row: PgRow, column: string): number | null {
  return row[column] === null ? null : requiredInteger(row, column);
}

function nullableInt8(row: PgRow, column: string): number | null {
  return row[column] === null ? null : pgInt8ToSafeInteger(row[column], column);
}

function nullableTimestamp(row: PgRow, column: string): string | null {
  return row[column] === null ? null : pgTimestampToIso(row[column], column);
}

function parseJson(value: unknown, column: string): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new TypeError(`${column} must contain valid JSON`);
  }
}

function parseCause(value: unknown, column: string): FailureCause {
  return FailureCauseSchema.parse(parseJson(value, column));
}

function nullableCause(value: unknown, column: string): FailureCause | null {
  return value === null ? null : parseCause(value, column);
}

export function pgInt8ToSafeInteger(value: unknown, column: string): number {
  if (typeof value !== "string" || !/^-?\d+$/.test(value)) {
    throw new TypeError(`${column} must be a safe int8 value`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new RangeError(`${column} must be a safe int8 value`);
  }
  return parsed;
}

export function pgTimestampToIso(value: unknown, column: string): string {
  if (!(value instanceof Date) && typeof value !== "string") {
    throw new TypeError(`${column} must be a valid PostgreSQL timestamp`);
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`${column} must be a valid PostgreSQL timestamp`);
  }
  return date.toISOString();
}

export function toIncidentSummary(value: unknown): IncidentSummary {
  const row = asRow(value);
  return IncidentSummarySchema.parse({
    id: requiredString(row, "id"),
    status: requiredString(row, "status"),
    startedAt: pgTimestampToIso(row.started_at, "started_at"),
    latestCause: parseCause(row.latest_cause, "latest_cause"),
  });
}

export function toPrivateHttpMonitor(value: unknown): PrivateHttpMonitor {
  const row = asRow(value);
  const activeIncidentId = row.active_incident_id;
  const activeIncident = activeIncidentId === null
    ? null
    : IncidentSummarySchema.parse({
      id: activeIncidentId,
      status: row.active_incident_status,
      startedAt: pgTimestampToIso(
        row.active_incident_started_at,
        "active_incident_started_at",
      ),
      latestCause: parseCause(
        row.active_incident_latest_cause,
        "active_incident_latest_cause",
      ),
    });

  return PrivateHttpMonitorSchema.parse({
    id: requiredString(row, "id"),
    kind: requiredString(row, "kind"),
    name: requiredString(row, "name"),
    state: requiredString(row, "state"),
    lifecycle: requiredString(row, "lifecycle"),
    published: requiredBoolean(row, "published"),
    publicSlug: null,
    intervalSeconds: requiredInteger(row, "interval_seconds"),
    failureThreshold: requiredInteger(row, "failure_threshold"),
    recoveryThreshold: requiredInteger(row, "recovery_threshold"),
    consecutiveFailures: pgInt8ToSafeInteger(
      row.consecutive_failures,
      "consecutive_failures",
    ),
    consecutiveSuccesses: pgInt8ToSafeInteger(
      row.consecutive_successes,
      "consecutive_successes",
    ),
    generation: pgInt8ToSafeInteger(row.generation, "generation"),
    nextSequence: pgInt8ToSafeInteger(row.next_sequence, "next_sequence"),
    lastEvaluatedSequence: pgInt8ToSafeInteger(
      row.last_evaluated_sequence,
      "last_evaluated_sequence",
    ),
    lastEvaluatedCheckAt: nullableTimestamp(row, "last_evaluated_check_at"),
    activeIncident,
    notificationChannelIds: [],
    url: requiredString(row, "url"),
    method: requiredString(row, "method"),
    timeoutSeconds: requiredInteger(row, "timeout_seconds"),
    acceptedStatus: {
      min: requiredInteger(row, "accepted_status_min"),
      max: requiredInteger(row, "accepted_status_max"),
    },
    headers: parseJson(row.headers, "headers"),
    nextCheckAt: nullableTimestamp(row, "next_check_at"),
    createdAt: pgTimestampToIso(row.created_at, "created_at"),
    updatedAt: pgTimestampToIso(row.updated_at, "updated_at"),
  });
}

export function toCheckRequest(value: unknown, prefix = ""): CheckRequest {
  const row = asRow(value);
  const column = (name: string): string => `${prefix}${name}`;
  const terminalAt = row[column("terminal_at")];
  return CheckRequestSchema.parse({
    id: requiredString(row, column("id")),
    monitorId: requiredString(row, column("monitor_id")),
    generation: pgInt8ToSafeInteger(row[column("generation")], column("generation")),
    sequence: pgInt8ToSafeInteger(row[column("sequence")], column("sequence")),
    source: requiredString(row, column("source")),
    status: requiredString(row, column("status")),
    scheduledAt: pgTimestampToIso(
      row[column("scheduled_at")],
      column("scheduled_at"),
    ),
    terminalAt: terminalAt === null
      ? null
      : pgTimestampToIso(terminalAt, column("terminal_at")),
    createdAt: pgTimestampToIso(row[column("created_at")], column("created_at")),
  });
}

export function toCheckHistoryItem(value: unknown): CheckHistoryItem {
  const row = asRow(value);
  const request = toCheckRequest(row, "request_");
  if (request.status === "pending") {
    return CheckHistoryItemSchema.parse({
      request,
      run: null,
      monitoringError: null,
    });
  }
  if (request.status === "cancelled-internal") {
    throw new Error("cancelled check history is not supported by the HTTP vertical slice");
  }

  return CheckHistoryItemSchema.parse({
    request,
    run: {
      id: requiredString(row, "run_id"),
      checkRequestId: request.id,
      monitorId: request.monitorId,
      generation: request.generation,
      sequence: request.sequence,
      result: requiredString(row, "run_result"),
      httpStatus: nullableInteger(row, "run_http_status"),
      latencyMs: nullableInt8(row, "run_latency_ms"),
      cause: nullableCause(row.run_cause, "run_cause"),
      completedAt: pgTimestampToIso(row.run_completed_at, "run_completed_at"),
      createdAt: pgTimestampToIso(row.run_created_at, "run_created_at"),
      evaluatedAt: nullableTimestamp(row, "run_evaluated_at"),
    },
    monitoringError: null,
  });
}

export function toIncident(value: unknown): Incident {
  const row = asRow(value);
  return IncidentSchema.parse({
    id: requiredString(row, "id"),
    monitorId: requiredString(row, "monitor_id"),
    monitorName: requiredString(row, "monitor_name"),
    status: requiredString(row, "status"),
    startedAt: pgTimestampToIso(row.started_at, "started_at"),
    resolvedAt: nullableTimestamp(row, "resolved_at"),
    openingCause: parseCause(row.opening_cause, "opening_cause"),
    latestCause: parseCause(row.latest_cause, "latest_cause"),
    resolutionReason: row.resolution_reason,
  });
}
