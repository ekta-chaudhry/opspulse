import { z } from "./zod.js";

export const IdSchema = z.uuid();
export type Id = z.infer<typeof IdSchema>;

export const TimestampSchema = z.iso.datetime({ offset: true });
export type Timestamp = z.infer<typeof TimestampSchema>;

export const CorrelationIdSchema = z.string().trim().min(1).max(128);
export type CorrelationId = z.infer<typeof CorrelationIdSchema>;

export const SafeMessageSchema = z.string().trim().min(1).max(500);
export type SafeMessage = z.infer<typeof SafeMessageSchema>;

function hasNoAuthorityUserinfo(value: string): boolean {
  const authority = /^https?:\/\/([^/?#]+)/i.exec(value)?.[1];
  return authority !== undefined && !authority.includes("@");
}

export const OutboundHttpUrlSchema = z
  .url({ protocol: /^https?$/i })
  .min(1)
  .max(2048)
  .refine(hasNoAuthorityUserinfo);
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
  .union([z.number(), z.string()])
  .pipe(z.coerce.number<number | string>().int().min(1).max(MAX_PAGE_SIZE))
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

export const PublicSlugParamsSchema = z.strictObject({ slug: PublicMonitorSlugSchema });
export type PublicSlugParams = z.infer<typeof PublicSlugParamsSchema>;
