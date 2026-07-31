import { WEBHOOK_PAYLOAD_VERSION, type FailureCause, type ResolutionReason } from "@opspulse/contracts";
import {
  buildIncidentOpenedWebhook,
  buildIncidentResolvedWebhook,
  serializeWebhookPayload,
} from "@opspulse/domain";
import type { TransactionClient } from "./transaction.js";

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
