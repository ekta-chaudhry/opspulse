import {
  HeartbeatMonitorInputSchema,
  HttpMonitorInputSchema,
  IdSchema,
  MonitorListQuerySchema,
  MonitorListResponseSchema,
  UpdateMonitorSchema,
  type CreateMonitorResponse,
  type HeartbeatMonitorInput,
  type HeartbeatTokenResponse,
  type HttpMonitorInput,
  type MonitorListQuery,
  type MonitorListResponse,
  type PrivateHttpMonitor,
  type PrivateMonitor,
  type UpdateMonitor,
} from "@opspulse/contracts";
import { createHash, randomBytes } from "node:crypto";
import type { QueryClient } from "./client.js";
import { decodeHistoryCursor, historyCursorForRow } from "./history.js";
import { toPrivateHeartbeatMonitor, toPrivateHttpMonitor, toPrivateMonitor } from "./rows.js";
import { withTransaction, type TransactionClient, type TransactionPool } from "./transaction.js";

const HTTP_MONITOR_COLUMNS = `
  m.*,
  i.status AS active_incident_status,
  i.started_at AS active_incident_started_at,
  i.latest_cause AS active_incident_latest_cause,
  COALESCE((
    SELECT array_agg(mnc.channel_id ORDER BY mnc.channel_id)
    FROM monitor_notification_channels mnc
    JOIN notification_channels nc ON nc.id = mnc.channel_id
    WHERE mnc.monitor_id = m.id
      AND mnc.enabled = true
      AND nc.lifecycle = 'active'
      AND nc.enabled = true
  ), ARRAY[]::uuid[]) AS notification_channel_ids
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

function generateHeartbeatToken(): string {
  return randomBytes(32).toString("base64url");
}

function heartbeatTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const heartbeatCredentials = (token: string) => ({
  token,
  pingPath: `/v1/heartbeats/${token}`,
});

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

export async function createHeartbeatMonitor(
  pool: QueryClient,
  input: HeartbeatMonitorInput,
  now: Date = new Date(),
  token: string = generateHeartbeatToken(),
): Promise<CreateMonitorResponse> {
  const monitor = HeartbeatMonitorInputSchema.parse(input);
  const result = await pool.query(
    `INSERT INTO monitors (
      kind, name, published, interval_seconds, failure_threshold, recovery_threshold,
      grace_period_seconds, next_heartbeat_deadline, heartbeat_token_hash,
      heartbeat_token_rotated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz + ($4::integer + $7::integer) * interval '1 second', $9, $8)
    RETURNING *`,
    [
      monitor.kind,
      monitor.name,
      monitor.published,
      monitor.intervalSeconds,
      monitor.failureThreshold,
      monitor.recoveryThreshold,
      monitor.gracePeriodSeconds,
      now,
      heartbeatTokenHash(token),
    ],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("heartbeat monitor insert returned no row");
  return {
    monitor: toPrivateHeartbeatMonitor(row),
    heartbeat: heartbeatCredentials(token),
  };
}

export async function rotateHeartbeatToken(
  pool: TransactionPool,
  id: string,
  now: Date = new Date(),
  token: string = generateHeartbeatToken(),
): Promise<HeartbeatTokenResponse> {
  const monitorId = IdSchema.parse(id);
  return withTransaction(pool, async (client) => {
    const monitor = await lockMonitor(client, monitorId);
    if (monitor.kind !== "heartbeat") {
      throw new MonitorLifecycleConflictError("Only heartbeat monitors have heartbeat tokens");
    }
    await client.query(
      `UPDATE monitors
      SET heartbeat_token_hash = $2,
          heartbeat_token_rotated_at = $3,
          updated_at = $3
      WHERE id = $1`,
      [monitorId, heartbeatTokenHash(token), now],
    );
    return {
      ...heartbeatCredentials(token),
      rotatedAt: now.toISOString(),
    };
  });
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
    SET status = 'cancelled-internal', terminal_at = GREATEST($2, created_at)
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
    const monitor = await lockMonitor(client, monitorId);
    if (monitor.lifecycle !== "active") {
      throw new MonitorLifecycleConflictError("Only active monitors can be paused");
    }
    await lockPendingChecks(client, monitorId);
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
    const monitor = await lockMonitor(client, monitorId);
    if (monitor.lifecycle !== "paused") {
      throw new MonitorLifecycleConflictError("Only paused monitors can be resumed");
    }
    await lockPendingChecks(client, monitorId);
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
    const monitor = await lockMonitor(client, monitorId);
    await lockPendingChecks(client, monitorId);
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

function hasScheduleChange(monitor: PrivateMonitor, update: UpdateMonitor): boolean {
  if (monitor.kind !== update.kind) return false;
  if (update.intervalSeconds !== undefined && update.intervalSeconds !== monitor.intervalSeconds) {
    return true;
  }
  if (monitor.kind === "heartbeat" && update.kind === "heartbeat") {
    return update.gracePeriodSeconds !== undefined &&
      update.gracePeriodSeconds !== monitor.gracePeriodSeconds;
  }
  if (monitor.kind === "http" && update.kind === "http") {
    return (
      (update.url !== undefined && update.url !== monitor.url) ||
      (update.method !== undefined && update.method !== monitor.method) ||
      (update.timeoutSeconds !== undefined && update.timeoutSeconds !== monitor.timeoutSeconds) ||
      (update.acceptedStatus !== undefined &&
        (update.acceptedStatus.min !== monitor.acceptedStatus.min ||
          update.acceptedStatus.max !== monitor.acceptedStatus.max)) ||
      (update.headers !== undefined &&
        JSON.stringify(update.headers) !== JSON.stringify(monitor.headers))
    );
  }
  return false;
}

export async function updateMonitor(
  pool: TransactionPool,
  id: string,
  input: UpdateMonitor,
  now: Date = new Date(),
): Promise<PrivateMonitor> {
  const monitorId = IdSchema.parse(id);
  const update = UpdateMonitorSchema.parse(input);
  return withTransaction(pool, async (client) => {
    const monitor = await lockMonitor(client, monitorId);
    if (monitor.kind !== update.kind) {
      throw new MonitorLifecycleConflictError("Monitor kind cannot be changed");
    }
    const scheduleChanged = hasScheduleChange(monitor, update);
    if (scheduleChanged) {
      await lockPendingChecks(client, monitorId);
      await cancelPendingChecks(client, monitorId, now);
    }

    const values: unknown[] = [monitorId, now];
    const assignments: string[] = [];
    const assign = (column: string, value: unknown, cast = ""): void => {
      if (value === undefined) return;
      values.push(value);
      assignments.push(`${column} = $${String(values.length)}${cast}`);
    };
    assign("name", update.name);
    assign("published", update.published);
    assign("interval_seconds", update.intervalSeconds);
    assign("failure_threshold", update.failureThreshold);
    assign("recovery_threshold", update.recoveryThreshold);
    if (update.kind === "http") {
      assign("url", update.url);
      assign("method", update.method);
      assign("timeout_seconds", update.timeoutSeconds);
      assign("accepted_status_min", update.acceptedStatus?.min);
      assign("accepted_status_max", update.acceptedStatus?.max);
      assign(
        "headers",
        update.headers === undefined ? undefined : JSON.stringify(update.headers),
        "::jsonb",
      );
    } else {
      assign("grace_period_seconds", update.gracePeriodSeconds);
    }

    const heartbeatDelay = update.kind === "heartbeat" && monitor.kind === "heartbeat"
      ? (update.intervalSeconds ?? monitor.intervalSeconds) +
        (update.gracePeriodSeconds ?? monitor.gracePeriodSeconds)
      : 0;
    values.push(heartbeatDelay);
    const heartbeatDelayParameter = values.length;
    values.push(scheduleChanged);
    const scheduleChangedParameter = values.length;
    assignments.push(
      `generation = generation + CASE WHEN $${String(scheduleChangedParameter)}::boolean THEN 1 ELSE 0 END`,
      `next_sequence = CASE WHEN $${String(scheduleChangedParameter)}::boolean THEN 1 ELSE next_sequence END`,
      `last_evaluated_sequence = CASE WHEN $${String(scheduleChangedParameter)}::boolean THEN 0 ELSE last_evaluated_sequence END`,
      `next_check_at = CASE
        WHEN $${String(scheduleChangedParameter)}::boolean AND kind = 'http' AND lifecycle = 'active' THEN $2
        WHEN $${String(scheduleChangedParameter)}::boolean AND kind = 'http' THEN NULL
        ELSE next_check_at
      END`,
      `next_heartbeat_deadline = CASE
        WHEN $${String(scheduleChangedParameter)}::boolean AND kind = 'heartbeat' AND lifecycle = 'active'
          THEN $2::timestamptz + $${String(heartbeatDelayParameter)}::integer * interval '1 second'
        WHEN $${String(scheduleChangedParameter)}::boolean AND kind = 'heartbeat' THEN NULL
        ELSE next_heartbeat_deadline
      END`,
      "updated_at = $2",
    );
    await client.query(
      `UPDATE monitors
      SET ${assignments.join(",\n          ")}
      WHERE id = $1`,
      values,
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
