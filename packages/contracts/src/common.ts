import { z } from "./zod.js";

export const IdSchema = z.uuid();
export type Id = z.infer<typeof IdSchema>;

export const TimestampSchema = z.iso.datetime({ offset: true });
export type Timestamp = z.infer<typeof TimestampSchema>;

export const CorrelationIdSchema = z.string().trim().min(1).max(128);
export type CorrelationId = z.infer<typeof CorrelationIdSchema>;

export const SafeMessageSchema = z.string().trim().min(1).max(500);
export type SafeMessage = z.infer<typeof SafeMessageSchema>;

const IpV6Schema = z.ipv6();

function hasValidHostname(hostname: string): boolean {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return IpV6Schema.safeParse(hostname.slice(1, -1)).success;
  }

  if (hostname.length > 253) {
    return false;
  }

  const labels = hostname.split(".");
  if (labels.every((label) => /^\d+$/.test(label))) {
    return (
      labels.length === 4 &&
      labels.every((label) => label.length > 0 && label.length <= 3 && Number(label) <= 255)
    );
  }

  return labels.every(
    (label) =>
      label.length > 0 &&
      label.length <= 63 &&
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label),
  );
}

function isOutboundHttpUrl(value: string): boolean {
  const match = /^https?:\/\/([^/?#\s]+)(?:[/?#][^\s]*)?$/i.exec(value);
  const authority = match?.[1];
  if (authority === undefined || authority.includes("@")) {
    return false;
  }

  let hostname = authority;
  let port: string | undefined;
  if (authority.startsWith("[")) {
    const bracketEnd = authority.indexOf("]");
    if (bracketEnd === -1) {
      return false;
    }
    hostname = authority.slice(0, bracketEnd + 1);
    const suffix = authority.slice(bracketEnd + 1);
    if (suffix !== "") {
      if (!suffix.startsWith(":")) {
        return false;
      }
      port = suffix.slice(1);
    }
  } else {
    const colon = authority.lastIndexOf(":");
    if (colon !== -1) {
      if (authority.indexOf(":") !== colon) {
        return false;
      }
      hostname = authority.slice(0, colon);
      port = authority.slice(colon + 1);
    }
  }

  if (port !== undefined && (!/^\d{1,5}$/.test(port) || Number(port) > 65_535)) {
    return false;
  }

  return hasValidHostname(hostname);
}

export const OutboundHttpUrlSchema = z.string().min(1).max(2048).refine(isOutboundHttpUrl);
export type OutboundHttpUrl = z.infer<typeof OutboundHttpUrlSchema>;

export const PublicMonitorSlugSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export type PublicMonitorSlug = z.infer<typeof PublicMonitorSlugSchema>;

export const CursorSchema = z.string().min(1).max(512);
export type Cursor = z.infer<typeof CursorSchema>;

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

const CursorLimitSchema = z
  .union([
    z.number(),
    z.string().regex(/^-?\d+$/).transform((value) => Number(value)),
  ])
  .pipe(z.number().int().min(1).max(MAX_PAGE_SIZE))
  .default(DEFAULT_PAGE_SIZE);

export const CursorQuerySchema = z.strictObject({
  cursor: CursorSchema.optional(),
  limit: CursorLimitSchema,
});
export type CursorQuery = z.infer<typeof CursorQuerySchema>;

export const CursorPageInfoSchema = z.strictObject({
  nextCursor: CursorSchema.nullable(),
  hasMore: z.boolean(),
});
export type CursorPageInfo = z.infer<typeof CursorPageInfoSchema>;

export const MonitorIdParamsSchema = z.strictObject({ monitorId: IdSchema });
export type MonitorIdParams = z.infer<typeof MonitorIdParamsSchema>;

export const IncidentIdParamsSchema = z.strictObject({ incidentId: IdSchema });
export type IncidentIdParams = z.infer<typeof IncidentIdParamsSchema>;

export const ChannelIdParamsSchema = z.strictObject({ channelId: IdSchema });
export type ChannelIdParams = z.infer<typeof ChannelIdParamsSchema>;

export const DeliveryIdParamsSchema = z.strictObject({ deliveryId: IdSchema });
export type DeliveryIdParams = z.infer<typeof DeliveryIdParamsSchema>;

export const PublicMonitorSlugParamsSchema = z.strictObject({ slug: PublicMonitorSlugSchema });
export type PublicMonitorSlugParams = z.infer<typeof PublicMonitorSlugParamsSchema>;
