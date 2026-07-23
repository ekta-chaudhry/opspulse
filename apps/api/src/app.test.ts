import {
  ApiErrorSchema,
  CheckListResponseSchema,
  CreateMonitorResponseSchema,
  IncidentListResponseSchema,
  LivenessResponseSchema,
  type CheckListResponse,
  type HttpMonitorInput,
  type IncidentListResponse,
  type PrivateHttpMonitor,
} from "@opspulse/contracts";
import { InvalidHistoryCursorError } from "@opspulse/database";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type AppDependencies } from "./app.js";

const monitor: PrivateHttpMonitor = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "http",
  name: "Example",
  state: "pending",
  lifecycle: "active",
  published: false,
  publicSlug: null,
  intervalSeconds: 60,
  failureThreshold: 2,
  recoveryThreshold: 1,
  consecutiveFailures: 0,
  consecutiveSuccesses: 0,
  generation: 0,
  nextSequence: 1,
  lastEvaluatedSequence: 0,
  lastEvaluatedCheckAt: null,
  activeIncident: null,
  notificationChannelIds: [],
  url: "https://example.test/health",
  method: "GET",
  timeoutSeconds: 5,
  acceptedStatus: { min: 200, max: 399 },
  headers: [],
  nextCheckAt: "2026-07-22T12:01:00.000Z",
  createdAt: "2026-07-22T12:00:00.000Z",
  updatedAt: "2026-07-22T12:00:00.000Z",
};

const emptyChecks: CheckListResponse = CheckListResponseSchema.parse({
  items: [],
  page: { nextCursor: null, hasMore: false },
});
const emptyIncidents: IncidentListResponse = IncidentListResponseSchema.parse({
  items: [],
  page: { nextCursor: null, hasMore: false },
});

function dependencies(): AppDependencies {
  return {
    createHttpMonitor: vi.fn(() => Promise.resolve(monitor)),
    listMonitorChecks: vi.fn(() => Promise.resolve(emptyChecks)),
    listIncidents: vi.fn(() => Promise.resolve(emptyIncidents)),
  };
}

async function listen(deps: AppDependencies): Promise<{ server: Server; baseUrl: string }> {
  const server = createApp(deps).listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${String(address.port)}` };
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
}

describe("OpsPulse API", () => {
  let server: Server;
  let baseUrl: string;
  let deps: AppDependencies;

  beforeEach(async () => {
    deps = dependencies();
    ({ server, baseUrl } = await listen(deps));
  });

  afterEach(async () => {
    await close(server);
  });

  it("serves a contract-valid API liveness response", async () => {
    const response = await fetch(`${baseUrl}/health/live`);
    expect(response.status).toBe(200);
    expect(LivenessResponseSchema.parse(await response.json())).toMatchObject({
      service: "api",
      status: "alive",
    });
  });

  it("creates an HTTP monitor with contract defaults", async () => {
    const response = await fetch(`${baseUrl}/v1/monitors`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "http",
        name: "Example",
        url: "https://example.test/health",
        method: "GET",
      }),
    });

    expect(response.status).toBe(201);
    expect(CreateMonitorResponseSchema.parse(await response.json())).toEqual({ monitor });
    expect(deps.createHttpMonitor).toHaveBeenCalledWith({
      kind: "http",
      name: "Example",
      published: false,
      intervalSeconds: 60,
      failureThreshold: 2,
      recoveryThreshold: 1,
      url: "https://example.test/health",
      method: "GET",
      timeoutSeconds: 5,
      acceptedStatus: { min: 200, max: 399 },
      headers: [],
    } satisfies HttpMonitorInput);
  });

  it("returns a stable conflict for heartbeat creation in this milestone", async () => {
    const response = await fetch(`${baseUrl}/v1/monitors`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-correlation-id": "heartbeat-test" },
      body: JSON.stringify({ kind: "heartbeat", name: "Nightly import" }),
    });
    const body = ApiErrorSchema.parse(await response.json());

    expect(response.status).toBe(409);
    expect(body).toEqual({
      error: {
        code: "conflict",
        message: "Heartbeat monitors are not implemented in this local milestone",
        correlationId: "heartbeat-test",
        details: [],
      },
    });
    expect(deps.createHttpMonitor).not.toHaveBeenCalled();
  });

  it("wraps invalid input in a correlated contract error", async () => {
    const response = await fetch(`${baseUrl}/v1/monitors`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-correlation-id": "validation-test" },
      body: JSON.stringify({ kind: "http", name: "", url: "file:///secret", secret: "do-not-leak" }),
    });
    const text = await response.text();
    const body = ApiErrorSchema.parse(JSON.parse(text));

    expect(response.status).toBe(400);
    expect(response.headers.get("x-correlation-id")).toBe("validation-test");
    expect(body.error.code).toBe("invalid_request");
    expect(body.error.correlationId).toBe("validation-test");
    expect(body.error.details.length).toBeGreaterThan(0);
    expect(text).not.toContain("do-not-leak");
  });

  it("replaces an invalid correlation ID", async () => {
    const response = await fetch(`${baseUrl}/health/live`, {
      headers: { "x-correlation-id": "   " },
    });
    expect(response.headers.get("x-correlation-id")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("validates check path and query values before listing", async () => {
    const invalidPath = await fetch(`${baseUrl}/v1/monitors/not-a-uuid/checks`);
    expect(invalidPath.status).toBe(400);
    expect(ApiErrorSchema.parse(await invalidPath.json()).error.code).toBe("invalid_request");

    const invalidLimit = await fetch(`${baseUrl}/v1/monitors/${monitor.id}/checks?limit=101`);
    expect(invalidLimit.status).toBe(400);

    const response = await fetch(
      `${baseUrl}/v1/monitors/${monitor.id}/checks?result=failure&from=2026-07-01T00%3A00%3A00.000Z&to=2026-07-22T00%3A00%3A00.000Z&cursor=abc&limit=12`,
    );
    expect(response.status).toBe(200);
    expect(CheckListResponseSchema.parse(await response.json())).toEqual(emptyChecks);
    expect(deps.listMonitorChecks).toHaveBeenCalledWith(monitor.id, {
      result: "failure",
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-07-22T00:00:00.000Z",
      cursor: "abc",
      limit: 12,
    });

    deps.listMonitorChecks = vi.fn(() => Promise.reject(new InvalidHistoryCursorError()));
    const malformedCursor = await fetch(
      `${baseUrl}/v1/monitors/${monitor.id}/checks?cursor=abc`,
    );
    const malformedBody = ApiErrorSchema.parse(await malformedCursor.json());
    expect(malformedCursor.status).toBe(400);
    expect(malformedBody.error.code).toBe("invalid_request");
    expect(malformedBody.error.details).toContainEqual({
      field: "cursor",
      issue: "Invalid cursor",
    });
  });

  it("validates incident filters before listing", async () => {
    const invalid = await fetch(`${baseUrl}/v1/incidents?status=pending&limit=0`);
    expect(invalid.status).toBe(400);
    expect(ApiErrorSchema.parse(await invalid.json()).error.code).toBe("invalid_request");

    const response = await fetch(
      `${baseUrl}/v1/incidents?monitorId=${monitor.id}&status=open&from=2026-07-01T00%3A00%3A00.000Z&to=2026-07-22T00%3A00%3A00.000Z&cursor=abc&limit=7`,
    );
    expect(response.status).toBe(200);
    expect(IncidentListResponseSchema.parse(await response.json())).toEqual(emptyIncidents);
    expect(deps.listIncidents).toHaveBeenCalledWith({
      monitorId: monitor.id,
      status: "open",
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-07-22T00:00:00.000Z",
      cursor: "abc",
      limit: 7,
    });
  });

  it("does not leak dependency errors or oversized request bodies", async () => {
    deps.createHttpMonitor = vi.fn(() =>
      Promise.reject(new Error("postgresql://owner:secret@private-db/opspulse")),
    );
    const dependencyResponse = await fetch(`${baseUrl}/v1/monitors`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "http",
        name: "Example",
        url: "https://example.test/health",
        method: "GET",
      }),
    });
    const dependencyText = await dependencyResponse.text();
    expect(dependencyResponse.status).toBe(500);
    expect(ApiErrorSchema.parse(JSON.parse(dependencyText)).error.code).toBe("internal_error");
    expect(dependencyText).not.toContain("private-db");
    expect(dependencyText).not.toContain("secret");

    const oversizedResponse = await fetch(`${baseUrl}/v1/monitors`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ padding: "x".repeat(65 * 1024) }),
    });
    expect(oversizedResponse.status).toBe(400);
    expect(ApiErrorSchema.parse(await oversizedResponse.json()).error.code).toBe(
      "invalid_request",
    );
  });
});
