import {
  ChannelIdParamsSchema,
  ChannelListQuerySchema,
  ChannelListResponseSchema,
  ChannelResponseSchema,
  CreateNotificationChannelSchema,
  IdSchema,
  UpdateNotificationChannelSchema,
  type ChannelListQuery,
  type ChannelListResponse,
  type ChannelResponse,
  type CreateNotificationChannel,
  type NotificationChannel,
  type UpdateNotificationChannel,
} from "@opspulse/contracts";
import type { QueryClient } from "./client.js";
import { decodeHistoryCursor, historyCursorForRow } from "./history.js";
import { MonitorNotFoundError } from "./monitors.js";
import { toNotificationChannel } from "./rows.js";
import { withTransaction, type TransactionPool } from "./transaction.js";

export class NotificationChannelNotFoundError extends Error {
  constructor() {
    super("Notification channel does not exist");
    this.name = "NotificationChannelNotFoundError";
  }
}

export class NotificationChannelLifecycleConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotificationChannelLifecycleConflictError";
  }
}

export async function createNotificationChannel(
  pool: QueryClient,
  input: CreateNotificationChannel,
  now: Date = new Date(),
): Promise<NotificationChannel> {
  const channel = CreateNotificationChannelSchema.parse(input);
  const result = await pool.query(
    `INSERT INTO notification_channels (
      name, webhook_url, signing_secret, enabled, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $5)
    RETURNING *`,
    [channel.name, channel.url, channel.signingSecret, channel.enabled, now],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("notification channel insert returned no row");
  return toNotificationChannel(row);
}

export async function listNotificationChannels(
  pool: QueryClient,
  options: ChannelListQuery,
): Promise<ChannelListResponse> {
  const query = ChannelListQuerySchema.parse(options);
  const filters: string[] = [];
  const values: unknown[] = [];
  if (query.lifecycle !== undefined) {
    values.push(query.lifecycle);
    filters.push(`lifecycle = $${String(values.length)}`);
  } else {
    filters.push("lifecycle = 'active'");
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
  const result = await pool.query(
    `SELECT *,
      to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at
    FROM notification_channels
    WHERE ${filters.join(" AND ")}
    ORDER BY created_at DESC, id DESC
    LIMIT $${String(values.length)}`,
    values,
  );
  const hasMore = result.rows.length > query.limit;
  const rows = result.rows.slice(0, query.limit);
  return ChannelListResponseSchema.parse({
    items: rows.map(toNotificationChannel),
    page: {
      nextCursor: hasMore
        ? historyCursorForRow(rows[rows.length - 1], "cursor_created_at", "id")
        : null,
      hasMore,
    },
  });
}

export async function updateNotificationChannel(
  pool: QueryClient,
  channelId: string,
  input: UpdateNotificationChannel,
  now: Date = new Date(),
): Promise<NotificationChannel> {
  const id = ChannelIdParamsSchema.parse({ channelId }).channelId;
  const update = UpdateNotificationChannelSchema.parse(input);
  const assignments: string[] = [];
  const values: unknown[] = [id];
  const add = (column: string, value: unknown): void => {
    values.push(value);
    assignments.push(`${column} = $${String(values.length)}`);
  };
  if (update.name !== undefined) add("name", update.name);
  if (update.url !== undefined) add("webhook_url", update.url);
  if (update.signingSecret !== undefined) add("signing_secret", update.signingSecret);
  if (update.enabled !== undefined) add("enabled", update.enabled);
  values.push(now);
  assignments.push(`updated_at = $${String(values.length)}`);
  const result = await pool.query(
    `UPDATE notification_channels
    SET ${assignments.join(", ")}
    WHERE id = $1 AND lifecycle = 'active'
    RETURNING *`,
    values,
  );
  const row = result.rows[0];
  if (row === undefined) throw new NotificationChannelNotFoundError();
  return toNotificationChannel(row);
}

export async function archiveNotificationChannel(
  pool: QueryClient,
  channelId: string,
  now: Date = new Date(),
): Promise<NotificationChannel> {
  const id = ChannelIdParamsSchema.parse({ channelId }).channelId;
  const result = await pool.query(
    `UPDATE notification_channels
    SET lifecycle = 'archived', enabled = false, updated_at = $2
    WHERE id = $1 AND lifecycle = 'active'
    RETURNING *`,
    [id, now],
  );
  const row = result.rows[0];
  if (row === undefined) throw new NotificationChannelNotFoundError();
  return toNotificationChannel(row);
}

async function ensureActiveMonitorAndChannel(
  pool: QueryClient,
  monitorId: string,
  channelId: string,
): Promise<void> {
  const result = await pool.query(
    `SELECT
      EXISTS (SELECT 1 FROM monitors WHERE id = $1 AND lifecycle <> 'archived') AS monitor_exists,
      EXISTS (SELECT 1 FROM notification_channels WHERE id = $2 AND lifecycle = 'active') AS channel_exists`,
    [monitorId, channelId],
  );
  const row = result.rows[0] as { monitor_exists?: unknown; channel_exists?: unknown } | undefined;
  if (row?.monitor_exists !== true) throw new MonitorNotFoundError();
  if (row.channel_exists !== true) throw new NotificationChannelNotFoundError();
}

export async function attachNotificationChannelToMonitor(
  pool: TransactionPool,
  monitorId: string,
  channelId: string,
  now: Date = new Date(),
): Promise<ChannelResponse> {
  const monitor = IdSchema.parse(monitorId);
  const channel = ChannelIdParamsSchema.parse({ channelId }).channelId;
  return withTransaction(pool, async (client) => {
    await ensureActiveMonitorAndChannel(client, monitor, channel);
    await client.query(
      `INSERT INTO monitor_notification_channels (monitor_id, channel_id, enabled, created_at, updated_at)
      VALUES ($1, $2, true, $3, $3)
      ON CONFLICT (monitor_id, channel_id)
      DO UPDATE SET enabled = true, updated_at = EXCLUDED.updated_at`,
      [monitor, channel, now],
    );
    const loaded = await client.query("SELECT * FROM notification_channels WHERE id = $1", [channel]);
    const row = loaded.rows[0];
    if (row === undefined) throw new NotificationChannelNotFoundError();
    return ChannelResponseSchema.parse({ channel: toNotificationChannel(row) });
  });
}

export async function detachNotificationChannelFromMonitor(
  pool: TransactionPool,
  monitorId: string,
  channelId: string,
  now: Date = new Date(),
): Promise<ChannelResponse> {
  const monitor = IdSchema.parse(monitorId);
  const channel = ChannelIdParamsSchema.parse({ channelId }).channelId;
  return withTransaction(pool, async (client) => {
    await ensureActiveMonitorAndChannel(client, monitor, channel);
    await client.query(
      `UPDATE monitor_notification_channels
      SET enabled = false, updated_at = $3
      WHERE monitor_id = $1 AND channel_id = $2`,
      [monitor, channel, now],
    );
    const loaded = await client.query("SELECT * FROM notification_channels WHERE id = $1", [channel]);
    const row = loaded.rows[0];
    if (row === undefined) throw new NotificationChannelNotFoundError();
    return ChannelResponseSchema.parse({ channel: toNotificationChannel(row) });
  });
}
