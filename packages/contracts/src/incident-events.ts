import { IdSchema, TimestampSchema } from "./common.js";
import { FailureCauseSchema } from "./failure-causes.js";
import { ResolutionReasonSchema } from "./incidents.js";
import { z } from "./zod.js";

export const OpenedDetailsSchema = z.strictObject({
  cause: FailureCauseSchema,
});
export type OpenedDetails = z.infer<typeof OpenedDetailsSchema>;

export const FailureObservedDetailsSchema = z.strictObject({
  previousCause: FailureCauseSchema,
  nextCause: FailureCauseSchema,
});
export type FailureObservedDetails = z.infer<typeof FailureObservedDetailsSchema>;

export const NotificationQueuedDetailsSchema = z.strictObject({
  deliveryId: IdSchema,
  channelId: IdSchema,
  payloadVersion: z.literal("opspulse.webhook.v1"),
});
export type NotificationQueuedDetails = z.infer<typeof NotificationQueuedDetailsSchema>;

export const RecoveryObservedDetailsSchema = z.strictObject({
  consecutiveSuccesses: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  recoveryThreshold: z.number().int().min(1).max(10),
});
export type RecoveryObservedDetails = z.infer<typeof RecoveryObservedDetailsSchema>;

export const ResolvedDetailsSchema = z.strictObject({
  reason: ResolutionReasonSchema,
});
export type ResolvedDetails = z.infer<typeof ResolvedDetailsSchema>;

const incidentEventShape = {
  id: IdSchema,
  incidentId: IdSchema,
  occurredAt: TimestampSchema,
};

export const OpenedIncidentEventSchema = z.strictObject({
  ...incidentEventShape,
  type: z.literal("opened"),
  details: OpenedDetailsSchema,
});
export type OpenedIncidentEvent = z.infer<typeof OpenedIncidentEventSchema>;

export const FailureObservedIncidentEventSchema = z.strictObject({
  ...incidentEventShape,
  type: z.literal("failure_observed"),
  details: FailureObservedDetailsSchema,
});
export type FailureObservedIncidentEvent = z.infer<typeof FailureObservedIncidentEventSchema>;

export const NotificationQueuedIncidentEventSchema = z.strictObject({
  ...incidentEventShape,
  type: z.literal("notification_queued"),
  details: NotificationQueuedDetailsSchema,
});
export type NotificationQueuedIncidentEvent = z.infer<
  typeof NotificationQueuedIncidentEventSchema
>;

export const RecoveryObservedIncidentEventSchema = z.strictObject({
  ...incidentEventShape,
  type: z.literal("recovery_observed"),
  details: RecoveryObservedDetailsSchema,
});
export type RecoveryObservedIncidentEvent = z.infer<typeof RecoveryObservedIncidentEventSchema>;

export const ResolvedIncidentEventSchema = z.strictObject({
  ...incidentEventShape,
  type: z.literal("resolved"),
  details: ResolvedDetailsSchema,
});
export type ResolvedIncidentEvent = z.infer<typeof ResolvedIncidentEventSchema>;

export const IncidentEventSchema = z.discriminatedUnion("type", [
  OpenedIncidentEventSchema,
  FailureObservedIncidentEventSchema,
  NotificationQueuedIncidentEventSchema,
  RecoveryObservedIncidentEventSchema,
  ResolvedIncidentEventSchema,
]);
export type IncidentEvent = z.infer<typeof IncidentEventSchema>;
