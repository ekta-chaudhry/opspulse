import { WEBHOOK_PAYLOAD_VERSION, type FailureCause, type ResolutionReason } from "@opspulse/contracts";
import {
  buildIncidentOpenedWebhook,
  buildIncidentResolvedWebhook,
  serializeWebhookPayload,
} from "@opspulse/domain";
import { withTransaction, type TransactionClient, type TransactionPool } from "./transaction.js";

export type IncidentNotificationTransition =
  | {
    type: "opened";
    cause: FailureCause;
    incident: { id: string; startedAt: string };
  }
  | {
    type: "resolved";
    resolution: ResolutionReason;
    incident: { id: string; startedAt: string; resolvedAt: string };
  };

export type IncidentNotificationMonitor = {
  id: string;
  name: string;
  state: "pending" | "up" | "degraded" | "down";
  publicSlug: string | null;
};

type NotificationChannelDestination = {
  id: string;
  webhook_url: string;
  signing_secret: string;
};

export type NotificationDeliveryWorkItem = {
  id: string;
  incidentEventId: string;
  channelId: string;
  webhookUrl: string;
  signingSecret: string;
  payload: unknown;
  attemptCount: number;
  replayOfDeliveryId: string | null;
};

export type NotificationAttemptInput = {
  outcome: "delivered" | "retryable_failure" | "final_failure";
  responseStatus: number | null;
  safeError: string | null;
};

const MAX_NOTIFICATION_ATTEMPTS = 6;

function safeInteger(value: unknown, column: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new TypeError(`${column} must be a safe integer`);
  }
  return value;
}

function nullableString(value: unknown, column: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new TypeError(`${column} must be a string or null`);
  return value;
}

function requiredString(value: unknown, column: string): string {
  if (typeof value !== "string") throw new TypeError(`${column} must be a string`);
  return value;
}

function toNotificationDeliveryWorkItem(row: unknown): NotificationDeliveryWorkItem {
  if (typeof row !== "object" || row === null) {
    throw new TypeError("notification delivery row must be an object");
  }
  const value = row as Record<string, unknown>;
  return {
    id: requiredString(value.id, "id"),
    incidentEventId: requiredString(value.incident_event_id, "incident_event_id"),
    channelId: requiredString(value.channel_id, "channel_id"),
    webhookUrl: requiredString(value.webhook_url, "webhook_url"),
    signingSecret: requiredString(value.signing_secret, "signing_secret"),
    payload: value.payload,
    attemptCount: safeInteger(value.attempt_count, "attempt_count"),
    replayOfDeliveryId: nullableString(value.replay_of_delivery_id, "replay_of_delivery_id"),
  };
}

function retryDelayMilliseconds(attemptNumber: number): number {
  const delays = [30_000, 60_000, 300_000, 900_000, 1_800_000] as const;
  return delays[Math.min(attemptNumber - 1, delays.length - 1)] ?? 1_800_000;
}

function validateAttempt(input: NotificationAttemptInput): NotificationAttemptInput {
  if (input.outcome === "delivered") {
    if (input.responseStatus === null || input.responseStatus < 200 || input.responseStatus > 299) {
      throw new TypeError("delivered attempts require a 2xx response status");
    }
    if (input.safeError !== null) throw new TypeError("delivered attempts cannot have a safe error");
  } else if (input.responseStatus === null && input.safeError === null) {
    throw new TypeError("failed attempts require a response status or safe error");
  }
  if (
    input.responseStatus !== null &&
    (!Number.isInteger(input.responseStatus) || input.responseStatus < 100 || input.responseStatus > 599)
  ) {
    throw new TypeError("responseStatus must be null or an HTTP status");
  }
  return input;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80)
    .replace(/-+$/u, "");
  return slug.length === 0 ? "monitor" : slug;
}

function monitorSlug(monitor: IncidentNotificationMonitor): string {
  if (monitor.publicSlug !== null) return monitor.publicSlug;
  return `${slugify(monitor.name)}-${monitor.id.slice(0, 8)}`;
}

function asIso(value: Date): string {
  return value.toISOString();
}

async function loadEnabledChannels(
  client: TransactionClient,
  monitorId: string,
): Promise<NotificationChannelDestination[]> {
  const result = await client.query(
    `SELECT nc.id, nc.webhook_url, nc.signing_secret
    FROM monitor_notification_channels mnc
    JOIN notification_channels nc ON nc.id = mnc.channel_id
    WHERE mnc.monitor_id = $1
      AND mnc.enabled = true
      AND nc.enabled = true
      AND nc.lifecycle = 'active'
    ORDER BY nc.id`,
    [monitorId],
  );
  return result.rows.map((row) => {
    const candidate = row as Partial<NotificationChannelDestination>;
    if (
      typeof candidate.id !== "string" ||
      typeof candidate.webhook_url !== "string" ||
      typeof candidate.signing_secret !== "string"
    ) {
      throw new TypeError("notification channel destination row is invalid");
    }
    return {
      id: candidate.id,
      webhook_url: candidate.webhook_url,
      signing_secret: candidate.signing_secret,
    };
  });
}

async function appendNotificationQueuedEvent(
  client: TransactionClient,
  incidentId: string,
  occurredAt: Date,
  deliveryId: string,
  channelId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO incident_events (incident_id, type, occurred_at, details)
    VALUES ($1, 'notification_queued', $2, $3::jsonb)`,
    [
      incidentId,
      occurredAt,
      JSON.stringify({
        deliveryId,
        channelId,
        payloadVersion: WEBHOOK_PAYLOAD_VERSION,
      }),
    ],
  );
}

export async function claimDueNotificationDelivery(
  pool: TransactionPool,
  now: Date = new Date(),
): Promise<NotificationDeliveryWorkItem | null> {
  return withTransaction(pool, async (client) => {
    const result = await client.query(
      `SELECT *
      FROM notification_deliveries
      WHERE status IN ('queued', 'retrying')
        AND next_attempt_at <= $1
      ORDER BY next_attempt_at, id
      LIMIT 1
      FOR UPDATE SKIP LOCKED`,
      [now],
    );
    const row = result.rows[0];
    return row === undefined ? null : toNotificationDeliveryWorkItem(row);
  });
}

export async function recordNotificationAttempt(
  pool: TransactionPool,
  deliveryId: string,
  input: NotificationAttemptInput,
  now: Date = new Date(),
): Promise<void> {
  const attempt = validateAttempt(input);
  await withTransaction(pool, async (client) => {
    const locked = await client.query(
      `SELECT id, attempt_count, status
      FROM notification_deliveries
      WHERE id = $1
      FOR UPDATE`,
      [deliveryId],
    );
    const row = locked.rows[0] as { attempt_count?: unknown; status?: unknown } | undefined;
    if (row === undefined) throw new Error("notification delivery does not exist");
    if (row.status === "delivered" || row.status === "failed") return;
    const nextAttempt = safeInteger(row.attempt_count, "attempt_count") + 1;
    if (nextAttempt > MAX_NOTIFICATION_ATTEMPTS) {
      throw new Error("notification delivery exhausted attempts");
    }
    await client.query(
      `INSERT INTO notification_attempts (
        delivery_id, attempt_number, started_at, completed_at, outcome,
        response_status, safe_error
      ) VALUES ($1, $2, $3, $3, $4, $5, $6)`,
      [
        deliveryId,
        nextAttempt,
        now,
        attempt.outcome,
        attempt.responseStatus,
        attempt.safeError,
      ],
    );

    const exhausted = nextAttempt >= MAX_NOTIFICATION_ATTEMPTS;
    const status = attempt.outcome === "delivered"
      ? "delivered"
      : attempt.outcome === "final_failure" || exhausted
        ? "failed"
        : "retrying";
    const nextAttemptAt = status === "retrying"
      ? new Date(now.getTime() + retryDelayMilliseconds(nextAttempt))
      : null;
    await client.query(
      `UPDATE notification_deliveries
      SET status = $2,
          attempt_count = $3,
          next_attempt_at = $4,
          last_response_status = $5,
          last_safe_error = $6,
          updated_at = $7
      WHERE id = $1`,
      [
        deliveryId,
        status,
        nextAttempt,
        nextAttemptAt,
        attempt.responseStatus,
        attempt.safeError,
        now,
      ],
    );
  });
}

export async function createIncidentNotificationDeliveries(
  client: TransactionClient,
  input: {
    monitor: IncidentNotificationMonitor;
    incidentEventId: string;
    occurredAt: Date;
    transition: IncidentNotificationTransition;
  },
): Promise<void> {
  const channels = await loadEnabledChannels(client, input.monitor.id);
  if (channels.length === 0) return;

  const occurredAt = asIso(input.occurredAt);
  const monitor = {
    slug: monitorSlug(input.monitor),
    name: input.monitor.name,
    state: input.transition.type === "opened" ? "down" as const : input.monitor.state,
  };
  const payload = input.transition.type === "opened"
    ? buildIncidentOpenedWebhook({
      eventId: input.incidentEventId,
      occurredAt,
      monitor: { ...monitor, state: "down" },
      incident: input.transition.incident,
      cause: input.transition.cause,
    })
    : buildIncidentResolvedWebhook({
      eventId: input.incidentEventId,
      occurredAt,
      monitor,
      incident: input.transition.incident,
      resolution: input.transition.resolution,
    });
  const serializedPayload = serializeWebhookPayload(payload);

  for (const channel of channels) {
    const deduplicationKey = [
      input.incidentEventId,
      channel.id,
      WEBHOOK_PAYLOAD_VERSION,
    ].join(":");
    const inserted = await client.query(
      `INSERT INTO notification_deliveries (
        incident_event_id, channel_id, monitor_id, deduplication_key, payload,
        webhook_url, signing_secret, next_attempt_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $8, $8)
      ON CONFLICT (deduplication_key) DO NOTHING
      RETURNING id`,
      [
        input.incidentEventId,
        channel.id,
        input.monitor.id,
        deduplicationKey,
        serializedPayload,
        channel.webhook_url,
        channel.signing_secret,
        input.occurredAt,
      ],
    );
    const deliveryRow = inserted.rows[0] as { id?: unknown } | undefined;
    if (deliveryRow?.id === undefined) continue;
    if (typeof deliveryRow.id !== "string") {
      throw new TypeError("notification delivery insert returned invalid id");
    }
    await appendNotificationQueuedEvent(
      client,
      input.transition.incident.id,
      input.occurredAt,
      deliveryRow.id,
      channel.id,
    );
  }
}
