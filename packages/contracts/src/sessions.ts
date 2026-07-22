import { IdSchema, TimestampSchema } from "./common.js";
import { z } from "./zod.js";

const EmailSchema = z.string().trim().toLowerCase().max(254).email();
const CsrfTokenSchema = z.string().min(43).max(128).regex(/^[A-Za-z0-9_-]+$/);

export const OwnerSchema = z.strictObject({
  id: IdSchema,
  email: EmailSchema,
  createdAt: TimestampSchema,
});
export type Owner = z.infer<typeof OwnerSchema>;

export const SessionClientSchema = z.strictObject({
  userAgent: z.string().max(512).nullable(),
  ipAddress: z.string().max(45).nullable(),
});
export type SessionClient = z.infer<typeof SessionClientSchema>;

export const OwnerSessionSchema = z.strictObject({
  id: IdSchema,
  createdAt: TimestampSchema,
  lastSeenAt: TimestampSchema,
  idleExpiresAt: TimestampSchema,
  absoluteExpiresAt: TimestampSchema,
  client: SessionClientSchema,
});
export type OwnerSession = z.infer<typeof OwnerSessionSchema>;

export const LoginRequestSchema = z.strictObject({
  email: EmailSchema,
  password: z.string().min(1).max(1024),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const SessionResponseSchema = z.strictObject({
  owner: OwnerSchema,
  session: OwnerSessionSchema,
  csrfToken: CsrfTokenSchema,
});
export type SessionResponse = z.infer<typeof SessionResponseSchema>;

export const CurrentSessionResponseSchema = z.strictObject({
  owner: OwnerSchema,
  session: OwnerSessionSchema,
});
export type CurrentSessionResponse = z.infer<typeof CurrentSessionResponseSchema>;

export const CsrfTokenResponseSchema = z.strictObject({
  csrfToken: CsrfTokenSchema,
});
export type CsrfTokenResponse = z.infer<typeof CsrfTokenResponseSchema>;
