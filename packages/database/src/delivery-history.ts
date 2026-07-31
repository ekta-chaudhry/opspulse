import {
  DeliveryIdParamsSchema,
  DeliveryListQuerySchema,
  DeliveryListResponseSchema,
  IncidentDetailResponseSchema,
  IdSchema,
  NotificationDeliverySchema,
  ReplayDeliverySchema,
  type DeliveryListQuery,
  type DeliveryListResponse,
  type IncidentDetailResponse,
  type IncidentEvent,
  type NotificationAttempt,
  type NotificationDelivery,
  type ReplayDelivery,
} from "@opspulse/contracts";
import type { QueryClient } from "./client.js";
import { decodeHistoryCursor, historyCursorForRow } from "./history.js";
import {
  pgInt8ToSafeInteger,
  pgTimestampToIso,
  toIncident,
} from "./rows.js";
import { withTransaction, type TransactionPool } from "./transaction.js";

export class NotificationDeliveryNotFoundError extends Error {
  constructor() {
    super("Notification delivery does not exist");
    this.name = "NotificationDeliveryNotFoundError";
  }
}

export class NotificationDeliveryReplayConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotificationDeliveryReplayConflictError";
  }
}

export class IncidentNotFoundError extends Error {
  constructor() {
    super("Incident does not exist");
    this.name = "IncidentNotFoundError";
  }
}

type PgRow = Record<string, unknown>;

function asRow(value: unknown): PgRow {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("database row must be an object");
  }
  return value as PgRow;
}

function stringValue(row: PgRow, column: string): string {
  const value = row[column];
  if (typeof value !== "string") throw new TypeError(`${column} must be a string`);
  return value;
}

function nullableStringValue(row: PgRow, column: string): string | null {
  const value = row[column];
  if (value === null) return null;
  if (typeof value !== "string") throw new TypeError(`${column} must be a string or null`);
  return value;
}

function integerValue(row: PgRow, column: string): number {
  const value = row[column];
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  return pgInt8ToSafeInteger(value, column);
}

function nullableIntegerValue(row: PgRow, column: string): number | null {
  const value = row[column];
  if (value === null) return null;
  return integerValue(row, column);
}

function nullableTimestampValue(row: PgRow, column: string): string | null {
  const value = row[column];
  return value === null ? null : pgTimestampToIso(value, column);
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return JSON.parse(value) as unknown;
}

function toNotificationAttempt(row: unknown): NotificationAttempt {
  const value = asRow(row);
  return {
    id: stringValue(value, "id"),
    deliveryId: stringValue(value, "delivery_id"),
    attemptNumber: integerValue(value, "attempt_number"),
    startedAt: pgTimestampToIso(value.started_at, "started_at"),
    completedAt: pgTimestampToIso(value.completed_at, "completed_at"),
    outcome: stringValue(value, "outcome"),
    responseStatus: nullableIntegerValue(value, "response_status"),
    safeError: nullableStringValue(value, "safe_error"),
  } as NotificationAttempt;
}

function toIncidentEvent(row: unknown): IncidentEvent {
  const value = asRow(row);
  return {
    id: stringValue(value, "id"),
    incidentId: stringValue(value, "incident_id"),
    type: stringValue(value, "type"),
    occurredAt: pgTimestampToIso(value.occurred_at, "occurred_at"),
    details: parseJson(value.details),
  } as IncidentEvent;
}

function toNotificationDelivery(
  row: unknown,
  attempts: readonly NotificationAttempt[],
): NotificationDelivery {
  const value = asRow(row);
  return NotificationDeliverySchema.parse({
    id: stringValue(value, "id"),
    incidentEventId: stringValue(value, "incident_event_id"),
    channelId: stringValue(value, "channel_id"),
    status: stringValue(value, "status"),
    deduplicationKey: stringValue(value, "deduplication_key"),
    replayOfDeliveryId: nullableStringValue(value, "replay_of_delivery_id"),
    attemptCount: integerValue(value, "attempt_count"),
    lastResponseStatus: nullableIntegerValue(value, "last_response_status"),
    lastSafeError: nullableStringValue(value, "last_safe_error"),
    nextAttemptAt: nullableTimestampValue(value, "next_attempt_at"),
    attempts,
    createdAt: pgTimestampToIso(value.created_at, "created_at"),
    updatedAt: pgTimestampToIso(value.updated_at, "updated_at"),
  });
}

async function attemptsByDeliveryId(
  client: QueryClient,
  deliveryIds: readonly string[],
): Promise<Map<string, NotificationAttempt[]>> {
  const byDelivery = new Map<string, NotificationAttempt[]>();
  if (deliveryIds.length === 0) return byDelivery;
  const result = await client.query(
    `SELECT * FROM notification_attempts
    WHERE delivery_id = ANY($1::uuid[])
    ORDER BY delivery_id, attempt_number`,
    [deliveryIds],
  );
  for (const row of result.rows) {
    const attempt = toNotificationAttempt(row);
    const attempts = byDelivery.get(attempt.deliveryId) ?? [];
    attempts.push(attempt);
    byDelivery.set(attempt.deliveryId, attempts);
  }
  return byDelivery;
}

async function deliveriesFromRows(
  client: QueryClient,
  rows: readonly unknown[],
): Promise<NotificationDelivery[]> {
  const ids = rows.map((row) => stringValue(asRow(row), "id"));
  const attempts = await attemptsByDeliveryId(client, ids);
  return rows.map((row) => {
    const id = stringValue(asRow(row), "id");
    return toNotificationDelivery(row, attempts.get(id) ?? []);
  });
}

export async function listNotificationDeliveries(
  pool: QueryClient,
  options: DeliveryListQuery,
): Promise<DeliveryListResponse> {
  const query = DeliveryListQuerySchema.parse(options);
  const filters: string[] = [];
  const values: unknown[] = [];
  for (const [column, value] of [
    ["status", query.status],
    ["monitor_id", query.monitorId],
    ["channel_id", query.channelId],
  ] as const) {
    if (value !== undefined) {
      values.push(value);
      filters.push(`${column} = $${String(values.length)}`);
    }
  }
  if (query.from !== undefined) {
    values.push(query.from);
    filters.push(`created_at >= $${String(values.length)}`);
  }
  if (query.to !== undefined) {
    values.push(query.to);
    filters.push(`created_at <= $${String(values.length)}`);
  }
  if (query.cursor !== undefined) {
    const cursor = decodeHistoryCursor(query.cursor);
    values.push(cursor.timestamp, cursor.id);
    const timestampParameter = values.length - 1;
    filters.push(
      `(created_at, id) < ($${String(timestampParameter)}::timestamptz, $${String(values.length)}::uuid)`,
    );
  }
  values.push(query.limit + 1);
  const where = filters.length === 0 ? "" : `WHERE ${filters.join(" AND ")}`;
  const result = await pool.query(
    `SELECT *,
      to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at
    FROM notification_deliveries
    ${where}
    ORDER BY created_at DESC, id DESC
    LIMIT $${String(values.length)}`,
    values,
  );
  const hasMore = result.rows.length > query.limit;
  const rows = result.rows.slice(0, query.limit);
  return DeliveryListResponseSchema.parse({
    items: await deliveriesFromRows(pool, rows),
    page: {
      nextCursor: hasMore
        ? historyCursorForRow(rows[rows.length - 1], "cursor_created_at", "id")
        : null,
      hasMore,
    },
  });
}

export async function replayNotificationDelivery(
  pool: TransactionPool,
  deliveryId: string,
  input: ReplayDelivery,
  now: Date = new Date(),
): Promise<NotificationDelivery> {
  const id = DeliveryIdParamsSchema.parse({ deliveryId }).deliveryId;
  ReplayDeliverySchema.parse(input);
  return withTransaction(pool, async (client) => {
    const original = await client.query(
      `SELECT * FROM notification_deliveries WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const row = original.rows[0];
    if (row === undefined) throw new NotificationDeliveryNotFoundError();
    const originalRow = asRow(row);
    if (originalRow.status !== "failed") {
      throw new NotificationDeliveryReplayConflictError("Only failed deliveries can be replayed");
    }
    const replayCount = await client.query(
      `SELECT count(*)::bigint AS replay_count
      FROM notification_deliveries
      WHERE replay_of_delivery_id = $1`,
      [id],
    );
    const replayNumber = pgInt8ToSafeInteger(
      asRow(replayCount.rows[0]).replay_count,
      "replay_count",
    ) + 1;
    const deduplicationKey = `${stringValue(originalRow, "deduplication_key")}:replay:${String(replayNumber)}`;
    const inserted = await client.query(
      `INSERT INTO notification_deliveries (
        incident_event_id, channel_id, monitor_id, deduplication_key, payload,
        webhook_url, signing_secret, replay_of_delivery_id, next_attempt_at,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $9, $9)
      RETURNING *`,
      [
        originalRow.incident_event_id,
        originalRow.channel_id,
        originalRow.monitor_id,
        deduplicationKey,
        JSON.stringify(parseJson(originalRow.payload)),
        originalRow.webhook_url,
        originalRow.signing_secret,
        id,
        now,
      ],
    );
    const insertedRow = inserted.rows[0];
    if (insertedRow === undefined) throw new Error("notification replay insert returned no row");
    return toNotificationDelivery(insertedRow, []);
  });
}

export async function getIncidentDetail(
  pool: QueryClient,
  incidentId: string,
): Promise<IncidentDetailResponse> {
  const id = IdSchema.parse(incidentId);
  const incidentResult = await pool.query("SELECT * FROM incidents WHERE id = $1", [id]);
  const incidentRow = incidentResult.rows[0];
  if (incidentRow === undefined) throw new IncidentNotFoundError();
  const timelineResult = await pool.query(
    `SELECT * FROM incident_events
    WHERE incident_id = $1
    ORDER BY occurred_at, id`,
    [id],
  );
  const deliveryResult = await pool.query(
    `SELECT nd.*
    FROM notification_deliveries nd
    JOIN incident_events ie ON ie.id = nd.incident_event_id
    WHERE ie.incident_id = $1
    ORDER BY nd.created_at, nd.id`,
    [id],
  );
  return IncidentDetailResponseSchema.parse({
    incident: toIncident(incidentRow),
    timeline: timelineResult.rows.map(toIncidentEvent),
    deliveries: await deliveriesFromRows(pool, deliveryResult.rows),
  });
}
