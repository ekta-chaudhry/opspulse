import {
  CursorPageInfoSchema,
  CursorQuerySchema,
  IdSchema,
  OutboundHttpUrlSchema,
  PublicMonitorSlugSchema,
  TimestampSchema,
} from "./common.js";
import { IncidentSummarySchema, type IncidentSummary } from "./incident-summary.js";
import { z } from "./zod.js";

export const MonitorKindSchema = z.enum(["http", "heartbeat"]);
export type MonitorKind = z.infer<typeof MonitorKindSchema>;

export const MonitorStateSchema = z.enum(["pending", "up", "degraded", "down"]);
export type MonitorState = z.infer<typeof MonitorStateSchema>;

export const MonitorLifecycleSchema = z.enum(["active", "paused", "archived"]);
export type MonitorLifecycle = z.infer<typeof MonitorLifecycleSchema>;

export const HttpMethodSchema = z.enum(["GET", "HEAD"]);
export type HttpMethod = z.infer<typeof HttpMethodSchema>;

const forbiddenHeaderNames = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "host",
]);
const forbiddenHeaderNamePattern =
  /(^|[-_])(auth|token|api[-_]?key|secret|credential|password)([-_]|$)/;

function isSafeHeaderName(name: string): boolean {
  const normalizedName = name.toLowerCase();
  return (
    !forbiddenHeaderNames.has(normalizedName) &&
    !forbiddenHeaderNamePattern.test(normalizedName)
  );
}

function isHttpHeaderValue(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (
      code !== 0x09 &&
      (code < 0x20 || code === 0x7f || code > 0xff)
    ) {
      return false;
    }
  }
  return true;
}

function isSafeHeaderValue(value: string): boolean {
  const trimmedValue = value.trim();
  return (
    !/^(basic|bearer|token) /i.test(trimmedValue) &&
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(trimmedValue) &&
    !/AKIA[A-Z0-9]{16}/.test(value)
  );
}

const AcceptedStatusRangeValueSchema = z
  .strictObject({
    min: z.number().int().min(100).max(599),
    max: z.number().int().min(100).max(599),
  })
  .refine(({ min, max }) => min <= max, {
    path: ["max"],
    message: "max must be greater than or equal to min",
  });

export const AcceptedStatusRangeSchema = AcceptedStatusRangeValueSchema.default({
  min: 200,
  max: 399,
});
export type AcceptedStatusRange = z.infer<typeof AcceptedStatusRangeSchema>;

export const RequestHeaderSchema = z.strictObject({
  name: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[!#$%&'*+\-.^_`|~A-Za-z0-9]+$/)
    .refine(isSafeHeaderName),
  value: z.string().max(1024).refine(isHttpHeaderValue).refine(isSafeHeaderValue),
});
export type RequestHeader = z.infer<typeof RequestHeaderSchema>;

const NameSchema = z.string().trim().min(1).max(100);
const IntervalSecondsSchema = z.number().int().min(30).max(86_400);
const ThresholdSchema = z.number().int().min(1).max(10);
const HeadersSchema = z
  .array(RequestHeaderSchema)
  .max(20)
  .refine((headers) => {
    const normalizedNames = headers.map(({ name }) => name.toLowerCase());
    return new Set(normalizedNames).size === normalizedNames.length;
  });

const createCommonShape = {
  name: NameSchema,
  published: z.boolean().default(false),
  intervalSeconds: IntervalSecondsSchema.default(60),
  failureThreshold: ThresholdSchema.default(2),
  recoveryThreshold: ThresholdSchema.default(1),
};

export const HttpMonitorInputSchema = z.strictObject({
  kind: z.literal("http"),
  ...createCommonShape,
  url: OutboundHttpUrlSchema,
  method: HttpMethodSchema,
  timeoutSeconds: z.number().int().min(1).max(30).default(5),
  acceptedStatus: AcceptedStatusRangeSchema,
  headers: HeadersSchema.default([]),
});
export type HttpMonitorInput = z.infer<typeof HttpMonitorInputSchema>;

export const HeartbeatMonitorInputSchema = z.strictObject({
  kind: z.literal("heartbeat"),
  ...createCommonShape,
  gracePeriodSeconds: z.number().int().min(0).max(86_400).default(60),
});
export type HeartbeatMonitorInput = z.infer<typeof HeartbeatMonitorInputSchema>;

export const CreateMonitorSchema = z.discriminatedUnion("kind", [
  HttpMonitorInputSchema,
  HeartbeatMonitorInputSchema,
]);
export type CreateMonitor = z.infer<typeof CreateMonitorSchema>;

const updateCommonShape = {
  name: NameSchema.optional(),
  published: z.boolean().optional(),
  intervalSeconds: IntervalSecondsSchema.optional(),
  failureThreshold: ThresholdSchema.optional(),
  recoveryThreshold: ThresholdSchema.optional(),
};

function hasUpdateChange(update: Record<string, unknown>): boolean {
  return Object.entries(update).some(([key, value]) => key !== "kind" && value !== undefined);
}

export const UpdateHttpMonitorSchema = z
  .strictObject({
    kind: z.literal("http"),
    ...updateCommonShape,
    url: OutboundHttpUrlSchema.optional(),
    method: HttpMethodSchema.optional(),
    timeoutSeconds: z.number().int().min(1).max(30).optional(),
    acceptedStatus: AcceptedStatusRangeValueSchema.optional(),
    headers: HeadersSchema.optional(),
  })
  .refine(hasUpdateChange, { message: "at least one change besides kind is required" });
export type UpdateHttpMonitor = z.infer<typeof UpdateHttpMonitorSchema>;

export const UpdateHeartbeatMonitorSchema = z
  .strictObject({
    kind: z.literal("heartbeat"),
    ...updateCommonShape,
    gracePeriodSeconds: z.number().int().min(0).max(86_400).optional(),
  })
  .refine(hasUpdateChange, { message: "at least one change besides kind is required" });
export type UpdateHeartbeatMonitor = z.infer<typeof UpdateHeartbeatMonitorSchema>;

export const UpdateMonitorSchema = z.discriminatedUnion("kind", [
  UpdateHttpMonitorSchema,
  UpdateHeartbeatMonitorSchema,
]);
export type UpdateMonitor = z.infer<typeof UpdateMonitorSchema>;

const NonnegativeSafeIntegerSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const PositiveSafeIntegerSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const UniqueIdsSchema = z
  .array(IdSchema)
  .max(100)
  .refine((ids) => {
    const canonicalIds = ids.map((id) => id.toLowerCase());
    return new Set(canonicalIds).size === canonicalIds.length;
  });
const ActiveIncidentSchema = IncidentSummarySchema.nullable() satisfies z.ZodType<
  IncidentSummary | null
>;

const privateCommonShape = {
  id: IdSchema,
  name: NameSchema,
  state: MonitorStateSchema,
  lifecycle: MonitorLifecycleSchema,
  published: z.boolean(),
  publicSlug: PublicMonitorSlugSchema.nullable(),
  intervalSeconds: IntervalSecondsSchema,
  failureThreshold: ThresholdSchema,
  recoveryThreshold: ThresholdSchema,
  consecutiveFailures: NonnegativeSafeIntegerSchema,
  consecutiveSuccesses: NonnegativeSafeIntegerSchema,
  generation: NonnegativeSafeIntegerSchema,
  nextSequence: PositiveSafeIntegerSchema,
  lastEvaluatedSequence: NonnegativeSafeIntegerSchema,
  lastEvaluatedCheckAt: TimestampSchema.nullable(),
  activeIncident: ActiveIncidentSchema,
  notificationChannelIds: UniqueIdsSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
};

export const PrivateHttpMonitorSchema = z
  .strictObject({
    ...privateCommonShape,
    kind: z.literal("http"),
    url: OutboundHttpUrlSchema,
    method: HttpMethodSchema,
    timeoutSeconds: z.number().int().min(1).max(30),
    acceptedStatus: AcceptedStatusRangeValueSchema,
    headers: HeadersSchema,
    nextCheckAt: TimestampSchema.nullable(),
  })
  .refine(({ nextSequence, lastEvaluatedSequence }) => nextSequence > lastEvaluatedSequence, {
    path: ["nextSequence"],
    message: "nextSequence must be greater than lastEvaluatedSequence",
  });
export type PrivateHttpMonitor = z.infer<typeof PrivateHttpMonitorSchema>;

export const PrivateHeartbeatMonitorSchema = z
  .strictObject({
    ...privateCommonShape,
    kind: z.literal("heartbeat"),
    gracePeriodSeconds: z.number().int().min(0).max(86_400),
    lastHeartbeatAt: TimestampSchema.nullable(),
    nextHeartbeatDeadline: TimestampSchema.nullable(),
  })
  .refine(({ nextSequence, lastEvaluatedSequence }) => nextSequence > lastEvaluatedSequence, {
    path: ["nextSequence"],
    message: "nextSequence must be greater than lastEvaluatedSequence",
  });
export type PrivateHeartbeatMonitor = z.infer<typeof PrivateHeartbeatMonitorSchema>;

export const PrivateMonitorSchema = z.discriminatedUnion("kind", [
  PrivateHttpMonitorSchema,
  PrivateHeartbeatMonitorSchema,
]);
export type PrivateMonitor = z.infer<typeof PrivateMonitorSchema>;

const QueryBooleanSchema = z.union([
  z.boolean(),
  z.enum(["true", "false"]).transform((value) => value === "true"),
]);

export const MonitorListQuerySchema = CursorQuerySchema.extend({
  kind: MonitorKindSchema.optional(),
  state: MonitorStateSchema.optional(),
  lifecycle: MonitorLifecycleSchema.optional(),
  published: QueryBooleanSchema.optional(),
});
export type MonitorListQuery = z.infer<typeof MonitorListQuerySchema>;

export const MonitorListResponseSchema = z.strictObject({
  items: z.array(PrivateMonitorSchema),
  page: CursorPageInfoSchema,
});
export type MonitorListResponse = z.infer<typeof MonitorListResponseSchema>;

export const MonitorResponseSchema = z.strictObject({
  monitor: PrivateMonitorSchema,
});
export type MonitorResponse = z.infer<typeof MonitorResponseSchema>;

const HeartbeatTokenSchema = z.string().min(43).max(128).regex(/^[A-Za-z0-9_-]+$/);
const HeartbeatPingPathSchema = z
  .string()
  .min(1)
  .max(2048)
  .regex(/^\/v1\/heartbeats\/[A-Za-z0-9_-]{43,128}$/);
const MatchingHeartbeatTokenRefinement = {
  path: ["pingPath"],
  message: "pingPath token must match token",
};

function hasMatchingHeartbeatToken(credentials: { token: string; pingPath: string }): boolean {
  return credentials.pingPath === `/v1/heartbeats/${credentials.token}`;
}

const HeartbeatCredentialsSchema = z
  .strictObject({
    token: HeartbeatTokenSchema,
    pingPath: HeartbeatPingPathSchema,
  })
  .refine(hasMatchingHeartbeatToken, MatchingHeartbeatTokenRefinement);

export const CreateMonitorResponseSchema = z.union([
  z.strictObject({ monitor: PrivateHttpMonitorSchema }),
  z.strictObject({
    monitor: PrivateHeartbeatMonitorSchema,
    heartbeat: HeartbeatCredentialsSchema,
  }),
]);
export type CreateMonitorResponse = z.infer<typeof CreateMonitorResponseSchema>;

export const LifecycleCommandResponseSchema = z.strictObject({
  monitor: PrivateMonitorSchema,
});
export type LifecycleCommandResponse = z.infer<typeof LifecycleCommandResponseSchema>;

export const HeartbeatTokenResponseSchema = z
  .strictObject({
    token: HeartbeatTokenSchema,
    pingPath: HeartbeatPingPathSchema,
    rotatedAt: TimestampSchema,
  })
  .refine(hasMatchingHeartbeatToken, MatchingHeartbeatTokenRefinement);
export type HeartbeatTokenResponse = z.infer<typeof HeartbeatTokenResponseSchema>;

export const ReplaceMonitorChannelsSchema = z.strictObject({
  channelIds: UniqueIdsSchema,
});
export type ReplaceMonitorChannels = z.infer<typeof ReplaceMonitorChannelsSchema>;
