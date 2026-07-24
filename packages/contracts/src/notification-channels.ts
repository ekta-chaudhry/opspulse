import {
  CursorPageInfoSchema,
  CursorQuerySchema,
  IdSchema,
  MAX_PAGE_SIZE,
  OutboundHttpUrlSchema,
  TimestampSchema,
} from "./common.js";
import { isTimestampAtOrAfter } from "./timestamp-order.js";
import { z } from "./zod.js";

export const ChannelLifecycleSchema = z.enum(["active", "archived"]);
export type ChannelLifecycle = z.infer<typeof ChannelLifecycleSchema>;

const ChannelNameSchema = z.string().trim().min(1).max(100);
const SigningSecretSchema = z.string().min(32).max(1024);

export const CreateNotificationChannelSchema = z.strictObject({
  name: ChannelNameSchema,
  url: OutboundHttpUrlSchema,
  signingSecret: SigningSecretSchema,
  enabled: z.boolean().default(true),
});
export type CreateNotificationChannel = z.infer<typeof CreateNotificationChannelSchema>;

export const UpdateNotificationChannelSchema = z
  .strictObject({
    name: ChannelNameSchema.optional(),
    url: OutboundHttpUrlSchema.optional(),
    signingSecret: SigningSecretSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .refine((update) => Object.values(update).some((value) => value !== undefined), {
    message: "at least one change is required",
  });
export type UpdateNotificationChannel = z.infer<typeof UpdateNotificationChannelSchema>;

export const NotificationChannelSchema = z
  .strictObject({
    id: IdSchema,
    name: ChannelNameSchema,
    enabled: z.boolean(),
    lifecycle: ChannelLifecycleSchema,
    destinationConfigured: z.literal(true),
    hasSigningSecret: z.literal(true),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .refine(({ createdAt, updatedAt }) => isTimestampAtOrAfter(updatedAt, createdAt), {
    path: ["updatedAt"],
    message: "updatedAt must be greater than or equal to createdAt",
  });
export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;

export const ChannelResponseSchema = z.strictObject({
  channel: NotificationChannelSchema,
});
export type ChannelResponse = z.infer<typeof ChannelResponseSchema>;

export const ChannelListQuerySchema = CursorQuerySchema.extend({
  lifecycle: ChannelLifecycleSchema.optional(),
});
export type ChannelListQuery = z.infer<typeof ChannelListQuerySchema>;

export const ChannelListResponseSchema = z.strictObject({
  items: z.array(NotificationChannelSchema).max(MAX_PAGE_SIZE),
  page: CursorPageInfoSchema,
});
export type ChannelListResponse = z.infer<typeof ChannelListResponseSchema>;

export const TestChannelResponseSchema = z.strictObject({
  deliveryId: IdSchema,
  queuedAt: TimestampSchema,
});
export type TestChannelResponse = z.infer<typeof TestChannelResponseSchema>;
