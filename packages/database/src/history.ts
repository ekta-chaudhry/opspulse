import {
  CheckListQuerySchema,
  CheckListResponseSchema,
  IdSchema,
  IncidentListQuerySchema,
  IncidentListResponseSchema,
  type CheckListResponse,
  type IncidentListResponse,
  type IncidentStatus,
} from "@opspulse/contracts";
import type { QueryClient } from "./client.js";
import { toCheckHistoryItem, toIncident } from "./rows.js";

export type HistoryLimit = { limit: number };

export type IncidentHistoryFilter = {
  monitorId?: string;
  status?: IncidentStatus;
  limit: number;
};

export async function listMonitorChecks(
  pool: QueryClient,
  monitorId: string,
  options: HistoryLimit,
): Promise<CheckListResponse> {
  const id = IdSchema.parse(monitorId);
  const { limit } = CheckListQuerySchema.parse(options);
  const result = await pool.query(
    `SELECT
      cr.id AS request_id,
      cr.monitor_id AS request_monitor_id,
      cr.generation AS request_generation,
      cr.sequence AS request_sequence,
      cr.source AS request_source,
      cr.status AS request_status,
      cr.scheduled_at AS request_scheduled_at,
      cr.terminal_at AS request_terminal_at,
      cr.created_at AS request_created_at,
      r.id AS run_id,
      r.result AS run_result,
      r.http_status AS run_http_status,
      r.latency_ms AS run_latency_ms,
      r.cause AS run_cause,
      r.completed_at AS run_completed_at,
      r.created_at AS run_created_at,
      r.evaluated_at AS run_evaluated_at
    FROM check_requests cr
    LEFT JOIN check_runs r ON r.request_id = cr.id
    WHERE cr.monitor_id = $1
    ORDER BY cr.scheduled_at DESC, cr.id DESC
    LIMIT $2`,
    [id, limit],
  );
  return CheckListResponseSchema.parse({
    items: result.rows.map(toCheckHistoryItem),
    page: { nextCursor: null, hasMore: false },
  });
}

export async function listIncidents(
  pool: QueryClient,
  options: IncidentHistoryFilter,
): Promise<IncidentListResponse> {
  const query = IncidentListQuerySchema.parse(options);
  const filters: string[] = [];
  const values: unknown[] = [];
  if (query.monitorId !== undefined) {
    values.push(query.monitorId);
    filters.push(`monitor_id = $${String(values.length)}`);
  }
  if (query.status !== undefined) {
    values.push(query.status);
    filters.push(`status = $${String(values.length)}`);
  }
  values.push(query.limit);
  const where = filters.length === 0 ? "" : `WHERE ${filters.join(" AND ")}`;
  const result = await pool.query(
    `SELECT * FROM incidents
    ${where}
    ORDER BY started_at DESC, id DESC
    LIMIT $${String(values.length)}`,
    values,
  );
  return IncidentListResponseSchema.parse({
    items: result.rows.map(toIncident),
    page: { nextCursor: null, hasMore: false },
  });
}
