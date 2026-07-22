import { IdSchema, TimestampSchema } from "./common.js";
import { z } from "./zod.js";

const HeartbeatTokenSchema = z.string().min(43).max(128).regex(/^[A-Za-z0-9_-]+$/);

function hasNoAsciiControls(value: string): boolean {
  for (const character of value) {
    const codePoint = character.charCodeAt(0);
    if (codePoint <= 0x1f || codePoint === 0x7f) {
      return false;
    }
  }
  return true;
}

export const HeartbeatTokenParamsSchema = z.strictObject({
  token: HeartbeatTokenSchema,
});
export type HeartbeatTokenParams = z.infer<typeof HeartbeatTokenParamsSchema>;

export const HeartbeatHeadersSchema = z.strictObject({
  "idempotency-key": z.string().trim().min(1).max(255).refine(hasNoAsciiControls).optional(),
});
export type HeartbeatHeaders = z.infer<typeof HeartbeatHeadersSchema>;

export const HeartbeatAcceptedSchema = z.strictObject({
  checkId: IdSchema,
  receivedAt: TimestampSchema,
  deduplicated: z.boolean(),
});
export type HeartbeatAccepted = z.infer<typeof HeartbeatAcceptedSchema>;
