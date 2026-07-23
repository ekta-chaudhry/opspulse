import {
  CheckListQuerySchema,
  CheckListResponseSchema,
  IdSchema,
  IncidentListQuerySchema,
  IncidentListResponseSchema,
  TimestampSchema,
  type CheckListResponse,
  type CheckListQuery,
  type IncidentListResponse,
  type IncidentListQuery,
} from "@opspulse/contracts";
import { Buffer } from "node:buffer";
import type { QueryClient } from "./client.js";
import { pgTimestampToIso, toCheckHistoryItem, toIncident } from "./rows.js";

export type CheckHistoryFilter = CheckListQuery;
export type IncidentHistoryFilter = IncidentListQuery;

type HistoryCursor = { timestamp: string; id: string };

export class InvalidHistoryCursorError extends Error {
  constructor() {
    super("Invalid history cursor");
    this.name = "InvalidHistoryCursorError";
  }
}

function encodeCursor(cursor: HistoryCursor): string {
  return Buffer.from(JSON.stringify([cursor.timestamp, cursor.id]), "utf8").toString(
    "base64url",
  );
}

function decodeCursor(value: string): HistoryCursor {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid base64url");
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      typeof parsed[0] !== "string" ||
      typeof parsed[1] !== "string"
    ) {
      throw new Error("invalid cursor payload");
    }
    const cursor = {
      timestamp: TimestampSchema.parse(parsed[0]),
      id: IdSchema.parse(parsed[1]),
    };
    if (encodeCursor(cursor) !== value) throw new Error("non-canonical cursor");
    return cursor;
  } catch {
    throw new InvalidHistoryCursorError();
  }
}

function cursorForRow(row: unknown, timestampColumn: string, idColumn: string): string {
  if (typeof row !== "object" || row === null) throw new TypeError("history row is invalid");
  const value = row as Record<string, unknown>;
  return encodeCursor({
    timestamp: pgTimestampToIso(value[timestampColumn], timestampColumn),
    id: IdSchema.parse(value[idColumn]),
  });
}

export async function listMonitorChecks(
  pool: QueryClient,
  monitorId: string,
  options: CheckHistoryFilter,
): Promise<CheckListResponse> {
  const id = IdSchema.parse(monitorId);
  const query = CheckListQuerySchema.parse(options);
  const filters = ["cr.monitor_id = $1"];
  const values: unknown[] = [id];
  if (query.result !== undefined) {
    values.push(query.result);
    filters.push(`r.result = $${String(values.length)}`);
  }
  if (query.from !== undefined) {
    values.push(query.from);
    filters.push(`cr.scheduled_at >= $${String(values.length)}`);
  }
  if (query.to !== undefined) {
    values.push(query.to);
    filters.push(`cr.scheduled_at <= $${String(values.length)}`);
  }
  if (query.cursor !== undefined) {
    const cursor = decodeCursor(query.cursor);
    values.push(cursor.timestamp, cursor.id);
    const timestampParameter = values.length - 1;
    filters.push(
      `(cr.scheduled_at, cr.id) < ($${String(timestampParameter)}::timestamptz, $${String(values.length)}::uuid)`,
    );
  }
  values.push(query.limit + 1);
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
    WHERE ${filters.join(" AND ")}
    ORDER BY cr.scheduled_at DESC, cr.id DESC
    LIMIT $${String(values.length)}`,
    values,
  );
  const hasMore = result.rows.length > query.limit;
  const rows = result.rows.slice(0, query.limit);
  return CheckListResponseSchema.parse({
    items: rows.map(toCheckHistoryItem),
    page: {
      nextCursor: hasMore
        ? cursorForRow(rows[rows.length - 1], "request_scheduled_at", "request_id")
        : null,
      hasMore,
    },
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
  if (query.from !== undefined) {
    values.push(query.from);
    filters.push(`started_at >= $${String(values.length)}`);
  }
  if (query.to !== undefined) {
    values.push(query.to);
    filters.push(`started_at <= $${String(values.length)}`);
  }
  if (query.cursor !== undefined) {
    const cursor = decodeCursor(query.cursor);
    values.push(cursor.timestamp, cursor.id);
    const timestampParameter = values.length - 1;
    filters.push(
      `(started_at, id) < ($${String(timestampParameter)}::timestamptz, $${String(values.length)}::uuid)`,
    );
  }
  values.push(query.limit + 1);
  const where = filters.length === 0 ? "" : `WHERE ${filters.join(" AND ")}`;
  const result = await pool.query(
    `SELECT * FROM incidents
    ${where}
    ORDER BY started_at DESC, id DESC
    LIMIT $${String(values.length)}`,
    values,
  );
  const hasMore = result.rows.length > query.limit;
  const rows = result.rows.slice(0, query.limit);
  return IncidentListResponseSchema.parse({
    items: rows.map(toIncident),
    page: {
      nextCursor: hasMore
        ? cursorForRow(rows[rows.length - 1], "started_at", "id")
        : null,
      hasMore,
    },
  });
}
