import {
  IdSchema,
  PublicMonitorSlugSchema,
  SafeMessageSchema,
  TimestampSchema,
} from "./common.js";
import { FailureCauseSchema } from "./failure-causes.js";
import { ResolutionReasonSchema } from "./incidents.js";
import { MonitorStateSchema } from "./monitors.js";
import { isTimestampAtOrAfter } from "./timestamp-order.js";
import { z } from "./zod.js";

export const WEBHOOK_PAYLOAD_VERSION = "opspulse.webhook.v1" as const;

export const WEBHOOK_HEADER_NAMES = Object.freeze({
  eventId: "X-OpsPulse-Event-ID",
  timestamp: "X-OpsPulse-Timestamp",
  signatureVersion: "X-OpsPulse-Signature-Version",
  signature: "X-OpsPulse-Signature",
  replayOf: "X-OpsPulse-Replay-Of",
} as const);

export const WebhookEventTypeSchema = z.enum(["incident.opened", "incident.resolved"]);
export type WebhookEventType = z.infer<typeof WebhookEventTypeSchema>;

const MonitorNameSchema = z.string().trim().min(1).max(100);
const WebhookMonitorSchema = z.strictObject({
  slug: PublicMonitorSlugSchema,
  name: MonitorNameSchema,
  state: MonitorStateSchema,
});
const OpenedWebhookMonitorSchema = z.strictObject({
  slug: PublicMonitorSlugSchema,
  name: MonitorNameSchema,
  state: z.literal("down"),
});

const OpenedWebhookIncidentSchema = z.strictObject({
  id: IdSchema,
  startedAt: TimestampSchema,
  resolvedAt: z.null(),
});
const ResolvedWebhookIncidentSchema = z
  .strictObject({
    id: IdSchema,
    startedAt: TimestampSchema,
    resolvedAt: TimestampSchema,
  })
  .refine(({ startedAt, resolvedAt }) => isTimestampAtOrAfter(resolvedAt, startedAt), {
    path: ["resolvedAt"],
    message: "resolvedAt must be greater than or equal to startedAt",
  });

const OpenedWebhookSummarySchema = z.strictObject({
  message: SafeMessageSchema,
  cause: FailureCauseSchema,
  resolution: z.null(),
});
const ResolvedWebhookSummarySchema = z.strictObject({
  message: SafeMessageSchema,
  cause: z.null(),
  resolution: ResolutionReasonSchema,
});

const webhookShape = {
  version: z.literal(WEBHOOK_PAYLOAD_VERSION),
  eventId: IdSchema,
  occurredAt: TimestampSchema,
};

export const OpenedWebhookSchema = z
  .strictObject({
    ...webhookShape,
    eventType: z.literal("incident.opened"),
    monitor: OpenedWebhookMonitorSchema,
    incident: OpenedWebhookIncidentSchema,
    summary: OpenedWebhookSummarySchema,
  })
  .refine(
    ({ occurredAt, incident }) =>
      isTimestampAtOrAfter(occurredAt, incident.startedAt) &&
      isTimestampAtOrAfter(incident.startedAt, occurredAt),
    {
      path: ["occurredAt"],
      message: "opened occurredAt must represent the same instant as incident startedAt",
    },
  );
export type OpenedWebhook = z.infer<typeof OpenedWebhookSchema>;

export const ResolvedWebhookSchema = z
  .strictObject({
    ...webhookShape,
    eventType: z.literal("incident.resolved"),
    monitor: WebhookMonitorSchema,
    incident: ResolvedWebhookIncidentSchema,
    summary: ResolvedWebhookSummarySchema,
  })
  .refine(
    ({ monitor, summary }) => summary.resolution !== "recovered" || monitor.state === "up",
    {
      path: ["monitor", "state"],
      message: "recovered incidents require an up monitor",
    },
  )
  .refine(
    ({ occurredAt, incident }) => isTimestampAtOrAfter(occurredAt, incident.resolvedAt),
    {
      path: ["occurredAt"],
      message: "occurredAt must be greater than or equal to incident resolvedAt",
    },
  );
export type ResolvedWebhook = z.infer<typeof ResolvedWebhookSchema>;

export const OpsPulseWebhookV1Schema = z.discriminatedUnion("eventType", [
  OpenedWebhookSchema,
  ResolvedWebhookSchema,
]);
export type OpsPulseWebhookV1 = z.infer<typeof OpsPulseWebhookV1Schema>;
