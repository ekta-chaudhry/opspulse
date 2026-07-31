import {
  OpsPulseWebhookV1Schema,
  type FailureCause,
  type MonitorState,
  type OpsPulseWebhookV1,
  type ResolutionReason,
} from "@opspulse/contracts";

export type WebhookMonitorSnapshot = {
  slug: string;
  name: string;
  state: MonitorState;
};

export type WebhookIncidentOpenedInput = {
  eventId: string;
  occurredAt: string;
  monitor: WebhookMonitorSnapshot & { state: "down" };
  incident: {
    id: string;
    startedAt: string;
  };
  cause: FailureCause;
};

export type WebhookIncidentResolvedInput = {
  eventId: string;
  occurredAt: string;
  monitor: WebhookMonitorSnapshot;
  incident: {
    id: string;
    startedAt: string;
    resolvedAt: string;
  };
  resolution: ResolutionReason;
};

export function buildIncidentOpenedWebhook(
  input: WebhookIncidentOpenedInput,
): OpsPulseWebhookV1 {
  return OpsPulseWebhookV1Schema.parse({
    version: "opspulse.webhook.v1",
    eventId: input.eventId,
    eventType: "incident.opened",
    occurredAt: input.occurredAt,
    monitor: input.monitor,
    incident: {
      id: input.incident.id,
      startedAt: input.incident.startedAt,
      resolvedAt: null,
    },
    summary: {
      message: input.cause.safeSummary,
      cause: input.cause,
      resolution: null,
    },
  });
}

export function buildIncidentResolvedWebhook(
  input: WebhookIncidentResolvedInput,
): OpsPulseWebhookV1 {
  return OpsPulseWebhookV1Schema.parse({
    version: "opspulse.webhook.v1",
    eventId: input.eventId,
    eventType: "incident.resolved",
    occurredAt: input.occurredAt,
    monitor: input.monitor,
    incident: input.incident,
    summary: {
      message: input.resolution === "recovered"
        ? "Monitor recovered"
        : "Monitor was archived",
      cause: null,
      resolution: input.resolution,
    },
  });
}

export function serializeWebhookPayload(payload: OpsPulseWebhookV1): string {
  return JSON.stringify(OpsPulseWebhookV1Schema.parse(payload));
}
