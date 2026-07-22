import {
  HttpMonitorInputSchema,
  IdSchema,
  type HttpMonitorInput,
  type PrivateHttpMonitor,
} from "@opspulse/contracts";
import type { QueryClient } from "./client.js";
import { toPrivateHttpMonitor } from "./rows.js";

const HTTP_MONITOR_COLUMNS = `
  m.*,
  i.status AS active_incident_status,
  i.started_at AS active_incident_started_at,
  i.latest_cause AS active_incident_latest_cause
`;

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

export { HTTP_MONITOR_COLUMNS };
