import { Buffer } from "node:buffer";
import { createHmac, timingSafeEqual } from "node:crypto";
import { WEBHOOK_HEADER_NAMES } from "@opspulse/contracts";

export const WEBHOOK_SIGNATURE_VERSION = "v1" as const;

export type SignedWebhook = {
  headers: Record<string, string>;
  body: string;
};

function signatureBase(timestamp: string, body: string): string {
  return `${timestamp}.${body}`;
}

export function signWebhookBody(
  secret: string,
  timestamp: string,
  body: string,
): string {
  const digest = createHmac("sha256", secret)
    .update(signatureBase(timestamp, body))
    .digest("hex");
  return `${WEBHOOK_SIGNATURE_VERSION}=${digest}`;
}

export function verifyWebhookSignature(
  secret: string,
  timestamp: string,
  body: string,
  signature: string,
): boolean {
  const expected = signWebhookBody(secret, timestamp, body);
  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(signature, "utf8");
  return expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer);
}

export function signedWebhookHeaders(input: {
  eventId: string;
  occurredAt: string;
  body: string;
  secret: string;
  replayOfDeliveryId?: string | null;
}): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    [WEBHOOK_HEADER_NAMES.eventId]: input.eventId,
    [WEBHOOK_HEADER_NAMES.timestamp]: input.occurredAt,
    [WEBHOOK_HEADER_NAMES.signatureVersion]: WEBHOOK_SIGNATURE_VERSION,
    [WEBHOOK_HEADER_NAMES.signature]: signWebhookBody(
      input.secret,
      input.occurredAt,
      input.body,
    ),
  };
  if (input.replayOfDeliveryId !== undefined && input.replayOfDeliveryId !== null) {
    headers[WEBHOOK_HEADER_NAMES.replayOf] = input.replayOfDeliveryId;
  }
  return headers;
}
