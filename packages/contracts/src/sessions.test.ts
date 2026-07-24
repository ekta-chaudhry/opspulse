import { describe, expect, it } from "vitest";
import {
  CsrfTokenResponseSchema,
  CurrentSessionResponseSchema,
  LoginRequestSchema,
  OwnerSchema,
  OwnerSessionSchema,
  SessionClientSchema,
  SessionResponseSchema,
} from "./sessions.js";

const id = "550e8400-e29b-41d4-a716-446655440000";
const timestamp = "2026-07-22T12:34:56Z";
const csrfToken = "a".repeat(43);
const owner = { id, email: "owner@example.com", createdAt: timestamp };
const client = { userAgent: null, ipAddress: null };
const session = {
  id,
  createdAt: timestamp,
  lastSeenAt: timestamp,
  idleExpiresAt: timestamp,
  absoluteExpiresAt: timestamp,
  client,
};

describe("session contracts", () => {
  it("normalizes owner email addresses", () => {
    expect(OwnerSchema.parse({ ...owner, email: "  OWNER@EXAMPLE.COM  " }).email).toBe(
      "owner@example.com",
    );
  });

  it("rejects invalid and overlong owner email addresses", () => {
    expect(OwnerSchema.safeParse({ ...owner, email: "not-an-email" }).success).toBe(false);
    expect(OwnerSchema.safeParse({ ...owner, email: `${"a".repeat(250)}@x.com` }).success).toBe(
      false,
    );
  });

  it("accepts exact nullable session client fields", () => {
    expect(SessionClientSchema.parse(client)).toEqual(client);
    expect(SessionClientSchema.safeParse({ userAgent: null, ipAddress: null, extra: true }).success).toBe(
      false,
    );
  });

  it("enforces the user-agent length limit", () => {
    expect(SessionClientSchema.safeParse({ ...client, userAgent: "x".repeat(512) }).success).toBe(
      true,
    );
    expect(SessionClientSchema.safeParse({ ...client, userAgent: "x".repeat(513) }).success).toBe(
      false,
    );
  });

  it("enforces the IP address length limit", () => {
    expect(SessionClientSchema.safeParse({ ...client, ipAddress: "x".repeat(45) }).success).toBe(true);
    expect(SessionClientSchema.safeParse({ ...client, ipAddress: "x".repeat(46) }).success).toBe(false);
  });

  it("accepts an exact owner session", () => {
    expect(OwnerSessionSchema.parse(session)).toEqual(session);
  });

  it("requires every owner session timestamp without defaults", () => {
    const sessionsMissingTimestamp = [
      {
        id: session.id,
        lastSeenAt: session.lastSeenAt,
        idleExpiresAt: session.idleExpiresAt,
        absoluteExpiresAt: session.absoluteExpiresAt,
        client: session.client,
      },
      {
        id: session.id,
        createdAt: session.createdAt,
        idleExpiresAt: session.idleExpiresAt,
        absoluteExpiresAt: session.absoluteExpiresAt,
        client: session.client,
      },
      {
        id: session.id,
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt,
        absoluteExpiresAt: session.absoluteExpiresAt,
        client: session.client,
      },
      {
        id: session.id,
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt,
        idleExpiresAt: session.idleExpiresAt,
        client: session.client,
      },
    ];
    for (const missingTimestamp of sessionsMissingTimestamp) {
      expect(OwnerSessionSchema.safeParse(missingTimestamp).success).toBe(false);
    }
    expect(OwnerSessionSchema.safeParse({ ...session, lastSeenAt: "2026-07-22T12:34:56" }).success).toBe(
      false,
    );
  });

  it("validates and normalizes an exact login request", () => {
    expect(LoginRequestSchema.parse({ email: "  OWNER@EXAMPLE.COM ", password: "secret" })).toEqual({
      email: "owner@example.com",
      password: "secret",
    });
    expect(
      LoginRequestSchema.safeParse({ email: "owner@example.com", password: "secret", extra: true })
        .success,
    ).toBe(false);
  });

  it("enforces login password bounds", () => {
    expect(LoginRequestSchema.safeParse({ email: owner.email, password: "x" }).success).toBe(true);
    expect(
      LoginRequestSchema.safeParse({ email: owner.email, password: "x".repeat(1024) }).success,
    ).toBe(true);
    expect(LoginRequestSchema.safeParse({ email: owner.email, password: "" }).success).toBe(false);
    expect(
      LoginRequestSchema.safeParse({ email: owner.email, password: "x".repeat(1025) }).success,
    ).toBe(false);
  });

  it("enforces CSRF token alphabet and bounds", () => {
    expect(CsrfTokenResponseSchema.safeParse({ csrfToken }).success).toBe(true);
    expect(CsrfTokenResponseSchema.safeParse({ csrfToken: "a".repeat(128) }).success).toBe(true);
    expect(CsrfTokenResponseSchema.safeParse({ csrfToken: "a".repeat(42) }).success).toBe(false);
    expect(CsrfTokenResponseSchema.safeParse({ csrfToken: "a".repeat(129) }).success).toBe(false);
    expect(
      CsrfTokenResponseSchema.safeParse({ csrfToken: `${"a".repeat(42)}+` }).success,
    ).toBe(false);
  });

  it("accepts exact session response variants", () => {
    expect(SessionResponseSchema.parse({ owner, session, csrfToken })).toEqual({
      owner,
      session,
      csrfToken,
    });
    expect(CurrentSessionResponseSchema.parse({ owner, session })).toEqual({ owner, session });
    expect(CsrfTokenResponseSchema.parse({ csrfToken })).toEqual({ csrfToken });
  });

  it("prevents password leakage in every response shape", () => {
    expect(SessionResponseSchema.safeParse({ owner, session, csrfToken, password: "secret" }).success).toBe(
      false,
    );
    expect(CurrentSessionResponseSchema.safeParse({ owner, session, password: "secret" }).success).toBe(
      false,
    );
    expect(CsrfTokenResponseSchema.safeParse({ csrfToken, password: "secret" }).success).toBe(false);
  });

  it("rejects unknown top-level and nested response fields", () => {
    expect(SessionResponseSchema.safeParse({ owner, session, csrfToken, extra: true }).success).toBe(false);
    expect(
      SessionResponseSchema.safeParse({ owner: { ...owner, extra: true }, session, csrfToken }).success,
    ).toBe(false);
    expect(
      SessionResponseSchema.safeParse({
        owner,
        session: { ...session, client: { ...client, extra: true } },
        csrfToken,
      }).success,
    ).toBe(false);
  });
});
