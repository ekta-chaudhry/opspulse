import {
  HttpMonitorInputSchema,
  IdSchema,
  MonitorListQuerySchema,
  MonitorListResponseSchema,
  type HttpMonitorInput,
  type MonitorListQuery,
  type MonitorListResponse,
  type PrivateHttpMonitor,
  type PrivateMonitor,
} from "@opspulse/contracts";
import type { QueryClient } from "./client.js";
import { decodeHistoryCursor, historyCursorForRow } from "./history.js";
import { toPrivateHttpMonitor, toPrivateMonitor } from "./rows.js";
import { withTransaction, type TransactionClient, type TransactionPool } from "./transaction.js";

const HTTP_MONITOR_COLUMNS = `
  m.*,
  i.status AS active_incident_status,
  i.started_at AS active_incident_started_at,
  i.latest_cause AS active_incident_latest_cause
`;

export class MonitorNotFoundError extends Error {
  constructor() {
    super("Monitor does not exist");
    this.name = "MonitorNotFoundError";
  }
}

export class MonitorLifecycleConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MonitorLifecycleConflictError";
  }
}

export async function createHttpMonitor(
  pool: QueryClient,
  input: HttpMonitorInput,
  now: Date = new Date(),
): Promise<PrivateHttpMonitor> {
  const monitor = HttpMonitorInputSchema.parse(input);
  const result = await pool.query(
    `INSERT INTO monitors (
      kind, name, published, interval_seconds, failure_threshold, recovery_threshold,
      url, method, timeout_seconds, accepted_status_min, accepted_status_max, headers,
      next_check_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)
    RETURNING *`,
    [
      monitor.kind,
      monitor.name,
      monitor.published,
      monitor.intervalSeconds,
      monitor.failureThreshold,
      monitor.recoveryThreshold,
      monitor.url,
      monitor.method,
      monitor.timeoutSeconds,
      monitor.acceptedStatus.min,
      monitor.acceptedStatus.max,
      JSON.stringify(monitor.headers),
      now,
    ],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("HTTP monitor insert returned no row");
  return toPrivateHttpMonitor(row);
}

export async function getHttpMonitor(
  pool: QueryClient,
  id: string,
): Promise<PrivateHttpMonitor | null> {
  const monitorId = IdSchema.parse(id);
  const result = await pool.query(
    `SELECT ${HTTP_MONITOR_COLUMNS}
    FROM monitors m
    LEFT JOIN incidents i ON i.id = m.active_incident_id
    WHERE m.id = $1 AND m.kind = 'http'`,
    [monitorId],
  );
  const row = result.rows[0];
  return row === undefined ? null : toPrivateHttpMonitor(row);
}

export async function getMonitor(
  pool: QueryClient,
  id: string,
): Promise<PrivateMonitor | null> {
  const monitorId = IdSchema.parse(id);
  const result = await pool.query(
    `SELECT ${HTTP_MONITOR_COLUMNS}
    FROM monitors m
    LEFT JOIN incidents i ON i.id = m.active_incident_id
    WHERE m.id = $1 AND m.lifecycle <> 'archived'`,
    [monitorId],
  );
  const row = result.rows[0];
  return row === undefined ? null : toPrivateMonitor(row);
}

async function lockMonitor(
  client: TransactionClient,
  id: string,
): Promise<PrivateMonitor> {
  const result = await client.query(
    `SELECT ${HTTP_MONITOR_COLUMNS}
    FROM monitors m
    LEFT JOIN incidents i ON i.id = m.active_incident_id
    WHERE m.id = $1 AND m.lifecycle <> 'archived'
    FOR UPDATE OF m`,
    [id],
  );
  const row = result.rows[0];
  if (row === undefined) throw new MonitorNotFoundError();
  const monitor = toPrivateMonitor(row);
  if (monitor.lifecycle === "archived") throw new MonitorNotFoundError();
  return monitor;
}

async function loadMonitor(
  client: TransactionClient,
  id: string,
): Promise<PrivateMonitor> {
  const result = await client.query(
    `SELECT ${HTTP_MONITOR_COLUMNS}
    FROM monitors m
    LEFT JOIN incidents i ON i.id = m.active_incident_id
    WHERE m.id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (row === undefined) throw new MonitorNotFoundError();
  return toPrivateMonitor(row);
}

async function cancelPendingChecks(
  client: TransactionClient,
  monitorId: string,
  now: Date,
): Promise<void> {
  await client.query(
    `UPDATE check_requests
    SET status = 'cancelled-internal', terminal_at = $2
    WHERE monitor_id = $1 AND status = 'pending'`,
    [monitorId, now],
  );
}

async function lockPendingChecks(
  client: TransactionClient,
  monitorId: string,
): Promise<void> {
  await client.query(
    `SELECT id FROM check_requests
    WHERE monitor_id = $1 AND status = 'pending'
    FOR UPDATE`,
    [monitorId],
  );
}

export async function pauseMonitor(
  pool: TransactionPool,
  id: string,
  now: Date = new Date(),
): Promise<PrivateMonitor> {
  const monitorId = IdSchema.parse(id);
  return withTransaction(pool, async (client) => {
    await lockPendingChecks(client, monitorId);
    const monitor = await lockMonitor(client, monitorId);
    if (monitor.lifecycle !== "active") {
      throw new MonitorLifecycleConflictError("Only active monitors can be paused");
    }
    await cancelPendingChecks(client, monitorId, now);
    await client.query(
      `UPDATE monitors
      SET lifecycle = 'paused',
          generation = generation + 1,
          next_sequence = 1,
          last_evaluated_sequence = 0,
          next_check_at = NULL,
          next_heartbeat_deadline = NULL,
          updated_at = $2
      WHERE id = $1`,
      [monitorId, now],
    );
    return loadMonitor(client, monitorId);
  });
}

export async function resumeMonitor(
  pool: TransactionPool,
  id: string,
  now: Date = new Date(),
): Promise<PrivateMonitor> {
  const monitorId = IdSchema.parse(id);
  return withTransaction(pool, async (client) => {
    await lockPendingChecks(client, monitorId);
    const monitor = await lockMonitor(client, monitorId);
    if (monitor.lifecycle !== "paused") {
      throw new MonitorLifecycleConflictError("Only paused monitors can be resumed");
    }
    await cancelPendingChecks(client, monitorId, now);
    if (monitor.kind === "http") {
      await client.query(
        `UPDATE monitors
        SET lifecycle = 'active',
            state = 'pending',
            consecutive_failures = 0,
            consecutive_successes = 0,
            generation = generation + 1,
            next_sequence = 1,
            last_evaluated_sequence = 0,
            last_evaluated_check_at = NULL,
            next_check_at = $2,
            updated_at = $2
        WHERE id = $1`,
        [monitorId, now],
      );
    } else {
      await client.query(
        `UPDATE monitors
        SET lifecycle = 'active',
            state = 'pending',
            consecutive_failures = 0,
            consecutive_successes = 0,
            generation = generation + 1,
            next_sequence = 1,
            last_evaluated_sequence = 0,
            last_evaluated_check_at = NULL,
            next_heartbeat_deadline = $2::timestamptz +
              (interval_seconds + grace_period_seconds) * interval '1 second',
            updated_at = $2
        WHERE id = $1`,
        [monitorId, now],
      );
    }
    return loadMonitor(client, monitorId);
  });
}

export async function archiveMonitor(
  pool: TransactionPool,
  id: string,
  now: Date = new Date(),
): Promise<PrivateMonitor> {
  const monitorId = IdSchema.parse(id);
  return withTransaction(pool, async (client) => {
    await lockPendingChecks(client, monitorId);
    const monitor = await lockMonitor(client, monitorId);
    await cancelPendingChecks(client, monitorId, now);
    if (monitor.activeIncident !== null) {
      await client.query(
        `UPDATE incidents
        SET status = 'resolved', resolved_at = $2, resolution_reason = 'monitor_archived'
        WHERE id = $1 AND status = 'open'`,
        [monitor.activeIncident.id, now],
      );
      await client.query(
        `INSERT INTO incident_events (incident_id, type, occurred_at, details)
        VALUES ($1, 'resolved', $2, $3::jsonb)`,
        [
          monitor.activeIncident.id,
          now,
          JSON.stringify({ reason: "monitor_archived" }),
        ],
      );
    }
    await client.query(
      `UPDATE monitors
      SET lifecycle = 'archived',
          published = false,
          generation = generation + 1,
          next_sequence = 1,
          last_evaluated_sequence = 0,
          active_incident_id = NULL,
          next_check_at = NULL,
          next_heartbeat_deadline = NULL,
          updated_at = $2
      WHERE id = $1`,
      [monitorId, now],
    );
    return loadMonitor(client, monitorId);
  });
}

export async function listMonitors(
  pool: QueryClient,
  options: MonitorListQuery,
): Promise<MonitorListResponse> {
  const query = MonitorListQuerySchema.parse(options);
  const filters: string[] = [];
  const values: unknown[] = [];
  for (const [column, value] of [
    ["kind", query.kind],
    ["state", query.state],
    ["lifecycle", query.lifecycle],
    ["published", query.published],
  ] as const) {
    if (value !== undefined) {
      values.push(value);
      filters.push(`m.${column} = $${String(values.length)}`);
    }
  }
  if (query.cursor !== undefined) {
    const cursor = decodeHistoryCursor(query.cursor);
    values.push(cursor.timestamp, cursor.id);
    const timestampParameter = values.length - 1;
    filters.push(
      `(m.created_at, m.id) < ($${String(timestampParameter)}::timestamptz, $${String(values.length)}::uuid)`,
    );
  }
  values.push(query.limit + 1);
  const where = filters.length === 0 ? "" : `WHERE ${filters.join(" AND ")}`;
  const result = await pool.query(
    `SELECT ${HTTP_MONITOR_COLUMNS},
      to_char(m.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at
    FROM monitors m
    LEFT JOIN incidents i ON i.id = m.active_incident_id
    ${where}
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT $${String(values.length)}`,
    values,
  );
  const hasMore = result.rows.length > query.limit;
  const rows = result.rows.slice(0, query.limit);
  return MonitorListResponseSchema.parse({
    items: rows.map(toPrivateMonitor),
    page: {
      nextCursor: hasMore
        ? historyCursorForRow(rows[rows.length - 1], "cursor_created_at", "id")
        : null,
      hasMore,
    },
  });
}

export { HTTP_MONITOR_COLUMNS };
