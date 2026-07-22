import { describe, expect, it } from "vitest";
import {
  ChannelLifecycleSchema,
  ChannelListQuerySchema,
  ChannelListResponseSchema,
  ChannelResponseSchema,
  CreateNotificationChannelSchema,
  NotificationChannelSchema,
  TestChannelResponseSchema,
  UpdateNotificationChannelSchema,
} from "./notification-channels.js";

const channelId = "550e8400-e29b-41d4-a716-446655440000";
const deliveryId = "018f4f1c-6f4a-4abc-9234-1234567890ab";
const timestamp = "2026-07-22T12:34:56.123456Z";
const createChannel = {
  name: "Primary webhook",
  url: "https://hooks.example.com/opspulse",
  signingSecret: "s".repeat(32),
} as const;
const channel = {
  id: channelId,
  name: "Primary webhook",
  enabled: true,
  lifecycle: "active",
  destinationConfigured: true,
  hasSigningSecret: true,
  createdAt: timestamp,
  updatedAt: timestamp,
} as const;

describe("notification channel inputs", () => {
  it("accepts only the approved lifecycle values", () => {
    expect(ChannelLifecycleSchema.options).toEqual(["active", "archived"]);
    expect(ChannelLifecycleSchema.safeParse("paused").success).toBe(false);
  });

  it("trims names and enforces normalized bounds", () => {
    expect(CreateNotificationChannelSchema.parse({ ...createChannel, name: "  a  " }).name).toBe(
      "a",
    );
    expect(CreateNotificationChannelSchema.safeParse({ ...createChannel, name: "" }).success).toBe(
      false,
    );
    expect(CreateNotificationChannelSchema.safeParse({ ...createChannel, name: "a" }).success).toBe(
      true,
    );
    expect(CreateNotificationChannelSchema.safeParse({
      ...createChannel,
      name: ` ${"n".repeat(100)} `,
    }).success).toBe(true);
    expect(CreateNotificationChannelSchema.safeParse({
      ...createChannel,
      name: "n".repeat(101),
    }).success).toBe(false);
  });

  it("uses the shared outbound HTTP URL validation", () => {
    expect(CreateNotificationChannelSchema.safeParse({
      ...createChannel,
      url: "http://hooks.example.com/opspulse",
    }).success).toBe(true);
    expect(CreateNotificationChannelSchema.safeParse({
      ...createChannel,
      url: `https://example.com/${"u".repeat(2028)}`,
    }).success).toBe(true);
    for (const url of [
      "ftp://hooks.example.com/opspulse",
      "https://user@hooks.example.com/opspulse",
      `https://example.com/${"u".repeat(2029)}`,
    ]) {
      expect(CreateNotificationChannelSchema.safeParse({ ...createChannel, url }).success).toBe(
        false,
      );
    }
  });

  it("preserves signing secrets exactly and enforces raw length bounds", () => {
    const spacedSecret = ` ${"s".repeat(30)} `;
    expect(CreateNotificationChannelSchema.parse({
      ...createChannel,
      signingSecret: spacedSecret,
    }).signingSecret).toBe(spacedSecret);
    for (const length of [32, 1024]) {
      expect(CreateNotificationChannelSchema.safeParse({
        ...createChannel,
        signingSecret: "s".repeat(length),
      }).success).toBe(true);
    }
    for (const length of [31, 1025]) {
      expect(CreateNotificationChannelSchema.safeParse({
        ...createChannel,
        signingSecret: "s".repeat(length),
      }).success).toBe(false);
    }
  });

  it("defaults enabled only on create and rejects unknown create fields", () => {
    expect(CreateNotificationChannelSchema.parse(createChannel)).toEqual({
      ...createChannel,
      enabled: true,
    });
    expect(CreateNotificationChannelSchema.parse({ ...createChannel, enabled: false }).enabled).toBe(
      false,
    );
    expect(CreateNotificationChannelSchema.safeParse({
      ...createChannel,
      lifecycle: "active",
    }).success).toBe(false);
  });

  it("accepts a nonempty exact update without injecting defaults", () => {
    expect(UpdateNotificationChannelSchema.parse({ name: "  Renamed  " })).toEqual({
      name: "Renamed",
    });
    expect(UpdateNotificationChannelSchema.parse({ enabled: false })).toEqual({ enabled: false });
    expect(UpdateNotificationChannelSchema.parse({
      url: "https://hooks.example.com/new",
      signingSecret: "x".repeat(32),
    })).toEqual({
      url: "https://hooks.example.com/new",
      signingSecret: "x".repeat(32),
    });
  });

  it("rejects empty updates, undefined-only updates, immutable fields, and unknown fields", () => {
    expect(UpdateNotificationChannelSchema.safeParse({}).success).toBe(false);
    expect(UpdateNotificationChannelSchema.safeParse({ enabled: undefined }).success).toBe(false);
    for (const forbidden of [
      { id: channelId },
      { lifecycle: "archived" },
      { createdAt: timestamp },
      { updatedAt: timestamp },
      { destinationConfigured: true },
      { hasSigningSecret: true },
      { ciphertext: "secret" },
    ]) {
      expect(UpdateNotificationChannelSchema.safeParse(forbidden).success).toBe(false);
    }
  });
});

describe("notification channel responses", () => {
  it("accepts the exact secret-safe channel allowlist and normalizes its name", () => {
    expect(NotificationChannelSchema.parse(channel)).toEqual(channel);
    expect(NotificationChannelSchema.parse({ ...channel, name: "  Primary webhook  " }).name).toBe(
      "Primary webhook",
    );
    expect(ChannelResponseSchema.parse({ channel })).toEqual({ channel });
  });

  it("rejects URL, secret, ciphertext, and unknown channel fields", () => {
    for (const leaked of [
      { url: "https://hooks.example.com" },
      { signingSecret: "s".repeat(32) },
      { encryptedSigningSecret: "ciphertext" },
      { ciphertext: "ciphertext" },
      { internalConfig: {} },
    ]) {
      expect(NotificationChannelSchema.safeParse({ ...channel, ...leaked }).success).toBe(false);
      expect(ChannelResponseSchema.safeParse({ channel: { ...channel, ...leaked } }).success).toBe(
        false,
      );
    }
  });

  it("requires literal configured flags and rejects unknown response keys", () => {
    expect(NotificationChannelSchema.safeParse({
      ...channel,
      destinationConfigured: false,
    }).success).toBe(false);
    expect(NotificationChannelSchema.safeParse({
      ...channel,
      hasSigningSecret: false,
    }).success).toBe(false);
    expect(ChannelResponseSchema.safeParse({ channel, extra: true }).success).toBe(false);
  });

  it("inherits pagination for lifecycle-filtered list queries", () => {
    expect(ChannelListQuerySchema.parse({})).toEqual({ limit: 25 });
    expect(ChannelListQuerySchema.parse({
      cursor: "next",
      limit: "100",
      lifecycle: "archived",
    })).toEqual({ cursor: "next", limit: 100, lifecycle: "archived" });
    expect(ChannelListQuerySchema.safeParse({ lifecycle: "paused" }).success).toBe(false);
    expect(ChannelListQuerySchema.safeParse({ extra: true }).success).toBe(false);
  });

  it("accepts exact list and test response envelopes", () => {
    const list = { items: [channel], page: { nextCursor: null, hasMore: false } } as const;
    expect(ChannelListResponseSchema.parse(list)).toEqual(list);
    expect(ChannelListResponseSchema.safeParse({ ...list, extra: true }).success).toBe(false);
    expect(ChannelListResponseSchema.safeParse({
      ...list,
      page: { ...list.page, extra: true },
    }).success).toBe(false);
    expect(TestChannelResponseSchema.parse({ deliveryId, queuedAt: timestamp })).toEqual({
      deliveryId,
      queuedAt: timestamp,
    });
    expect(TestChannelResponseSchema.safeParse({
      deliveryId,
      queuedAt: timestamp,
      status: "queued",
    }).success).toBe(false);
  });
});
