import {
  ApiErrorSchema,
  ChannelListResponseSchema,
  ChannelResponseSchema,
  CheckListResponseSchema,
  CreateMonitorResponseSchema,
  DeliveryListResponseSchema,
  IncidentDetailResponseSchema,
  IncidentListResponseSchema,
  LivenessResponseSchema,
  LifecycleCommandResponseSchema,
  MonitorListResponseSchema,
  MonitorResponseSchema,
  type ChannelListResponse,
  type CheckListResponse,
  type DeliveryListResponse,
  type HeartbeatMonitorInput,
  type HttpMonitorInput,
  type IncidentDetailResponse,
  type IncidentListResponse,
  type MonitorListResponse,
  type PrivateHeartbeatMonitor,
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

const heartbeatMonitor: PrivateHeartbeatMonitor = {
  id: "44444444-4444-4444-8444-444444444444",
  kind: "heartbeat",
  name: "Nightly import",
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
  gracePeriodSeconds: 60,
  lastHeartbeatAt: null,
  nextHeartbeatDeadline: "2026-07-22T12:02:00.000Z",
  createdAt: "2026-07-22T12:00:00.000Z",
  updatedAt: "2026-07-22T12:00:00.000Z",
};
const heartbeatToken = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";
const heartbeatCredentials = {
  token: heartbeatToken,
  pingPath: `/v1/heartbeats/${heartbeatToken}`,
};

const emptyChecks: CheckListResponse = CheckListResponseSchema.parse({
  items: [],
  page: { nextCursor: null, hasMore: false },
});
const emptyIncidents: IncidentListResponse = IncidentListResponseSchema.parse({
  items: [],
  page: { nextCursor: null, hasMore: false },
});
const emptyDeliveries: DeliveryListResponse = DeliveryListResponseSchema.parse({
  items: [],
  page: { nextCursor: null, hasMore: false },
});
const incidentDetail: IncidentDetailResponse = IncidentDetailResponseSchema.parse({
  incident: {
    id: "33333333-3333-4333-8333-333333333333",
    monitorId: monitor.id,
    monitorName: monitor.name,
    status: "open",
    startedAt: "2026-07-22T12:00:00.000Z",
    resolvedAt: null,
    openingCause: {
      category: "dns",
      code: "ENOTFOUND",
      httpStatus: null,
      safeSummary: "Target hostname could not be resolved",
    },
    latestCause: {
      category: "dns",
      code: "ENOTFOUND",
      httpStatus: null,
      safeSummary: "Target hostname could not be resolved",
    },
    resolutionReason: null,
  },
  timeline: [],
  deliveries: [],
});
const monitors: MonitorListResponse = MonitorListResponseSchema.parse({
  items: [monitor],
  page: { nextCursor: null, hasMore: false },
});
const channel = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Alerts",
  enabled: true,
  lifecycle: "active" as const,
  destinationConfigured: true as const,
  hasSigningSecret: true as const,
  createdAt: "2026-07-22T12:00:00.000Z",
  updatedAt: "2026-07-22T12:00:00.000Z",
};
const channels: ChannelListResponse = ChannelListResponseSchema.parse({
  items: [channel],
  page: { nextCursor: null, hasMore: false },
});

function dependencies(): AppDependencies {
  return {
    archiveMonitor: vi.fn(() => Promise.resolve({
      ...monitor,
      lifecycle: "archived" as const,
    })),
    archiveNotificationChannel: vi.fn(() => Promise.resolve({
      ...channel,
      lifecycle: "archived" as const,
      enabled: false,
    })),
    attachNotificationChannelToMonitor: vi.fn(() => Promise.resolve({ channel })),
    createHeartbeatMonitor: vi.fn(() => Promise.resolve({
      monitor: heartbeatMonitor,
      heartbeat: heartbeatCredentials,
    })),
    createHttpMonitor: vi.fn(() => Promise.resolve(monitor)),
    createNotificationChannel: vi.fn(() => Promise.resolve(channel)),
    detachNotificationChannelFromMonitor: vi.fn(() => Promise.resolve({ channel })),

    getIncidentDetail: vi.fn(() => Promise.resolve(incidentDetail)),
    getMonitor: vi.fn(() => Promise.resolve(monitor)),
    listChecks: vi.fn(() => Promise.resolve(emptyChecks)),
    listMonitors: vi.fn(() => Promise.resolve(monitors)),
    listNotificationChannels: vi.fn(() => Promise.resolve(channels)),
    listNotificationDeliveries: vi.fn(() => Promise.resolve(emptyDeliveries)),
    pauseMonitor: vi.fn(() => Promise.resolve({
      ...monitor,
      lifecycle: "paused" as const,
    })),
    replayNotificationDelivery: vi.fn(() => Promise.resolve(emptyDeliveries.items[0] ?? null)),
    recordHeartbeatPing: vi.fn(() => Promise.resolve({
      checkId: "55555555-5555-4555-8555-555555555555",
      receivedAt: "2026-07-22T12:06:00.000Z",
      deduplicated: false,
    })),
    resumeMonitor: vi.fn(() => Promise.resolve(monitor)),
    rotateHeartbeatToken: vi.fn(() => Promise.resolve({
      ...heartbeatCredentials,
      rotatedAt: "2026-07-22T12:05:00.000Z",
    })),
    updateMonitor: vi.fn(() => Promise.resolve({ ...monitor, name: "Primary API" })),
    updateNotificationChannel: vi.fn(() => Promise.resolve({ ...channel, name: "Pager" })),
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

  it("serves the operations dashboard shell", async () => {
    const response = await fetch(`${baseUrl}/`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("OpsPulse");
    expect(html).toContain('id="monitors"');
    expect(html).toContain('id="recent-checks"');
    expect(html).toContain('id="open-incidents"');
    expect(html).toContain("/v1/monitors?limit=50");
    expect(html).toContain("/v1/incidents?status=open&limit=50");
    expect(html).toContain("/v1/checks?limit=12");
    expect(html).toContain("fetchAllPages");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("if (loading) return");
    expect(html).not.toContain("'/v1/monitors/' + encodeURIComponent");
    expect(html).toContain('id="new-monitor"');
    expect(html).toContain('id="monitor-form"');
    expect(html).toContain('id="monitor-detail"');
    expect(html).toContain("openMonitor");
    expect(html).toContain("runLifecycleCommand");
    expect(html).toContain("/' + command");
    expect(html).toContain("badge('paused')");
    expect(html).toContain("cancelled-internal");
    expect(html).toContain("view.setAttribute('aria-label', 'View ' + monitor.name)");
    expect(html).not.toContain("fetchAllPages(monitorPath + '/checks");
    expect(html).toContain('id="monitor-status-min"');
    expect(html).toContain('id="monitor-status-max"');
    expect(html).toContain('id="monitor-headers"');
    expect(html).toContain("openMonitorForm(monitor)");
    expect(html).toContain("method: editingMonitorId ? 'PATCH' : 'POST'");
  });

  it("lists monitors through the existing contract", async () => {
    const response = await fetch(
      `${baseUrl}/v1/monitors?kind=http&state=pending&lifecycle=active&published=false&cursor=abc&limit=12`,
    );

    expect(response.status).toBe(200);
    expect(MonitorListResponseSchema.parse(await response.json())).toEqual(monitors);
    expect(deps.listMonitors).toHaveBeenCalledWith({
      kind: "http",
      state: "pending",
      lifecycle: "active",
      published: false,
      cursor: "abc",
      limit: 12,
    });
  });

  it("gets a monitor by ID through the monitor response contract", async () => {
    const response = await fetch(`${baseUrl}/v1/monitors/${monitor.id}`);

    expect(response.status).toBe(200);
    expect(MonitorResponseSchema.parse(await response.json())).toEqual({ monitor });
    expect(deps.getMonitor).toHaveBeenCalledWith(monitor.id);
  });

  it("updates a monitor through the existing update contract", async () => {
    const response = await fetch(`${baseUrl}/v1/monitors/${monitor.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "http", name: "Primary API" }),
    });

    expect(response.status).toBe(200);
    expect(MonitorResponseSchema.parse(await response.json()).monitor.name).toBe("Primary API");
    expect(deps.updateMonitor).toHaveBeenCalledWith(monitor.id, {
      kind: "http",
      name: "Primary API",
    });
  });

  it("rejects empty monitor updates before persistence", async () => {
    const response = await fetch(`${baseUrl}/v1/monitors/${monitor.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "http" }),
    });

    expect(response.status).toBe(400);
    expect(deps.updateMonitor).not.toHaveBeenCalled();
  });

  it("returns not found when a monitor detail is unavailable", async () => {
    deps.getMonitor = vi.fn(() => Promise.resolve(null));

    const response = await fetch(`${baseUrl}/v1/monitors/${monitor.id}`);

    expect(response.status).toBe(404);
    expect(ApiErrorSchema.parse(await response.json()).error.code).toBe("not_found");
  });

  it.each([
    ["pause", "paused"],
    ["resume", "active"],
    ["archive", "archived"],
  ] as const)("applies the %s lifecycle command", async (command, lifecycle) => {
    const response = await fetch(`${baseUrl}/v1/monitors/${monitor.id}/${command}`, {
      method: "POST",
    });
    const body = LifecycleCommandResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(body.monitor.lifecycle).toBe(lifecycle);
    expect(deps[`${command}Monitor`]).toHaveBeenCalledWith(monitor.id);
  });

  it("lists recent checks across monitors through the existing check contract", async () => {
    const response = await fetch(`${baseUrl}/v1/checks?result=failure&limit=12`);

    expect(response.status).toBe(200);
    expect(CheckListResponseSchema.parse(await response.json())).toEqual(emptyChecks);
    expect(deps.listChecks).toHaveBeenCalledWith({ result: "failure", limit: 12 });
  });

  it("manages notification channels through channel contracts", async () => {
    const listResponse = await fetch(`${baseUrl}/v1/channels?lifecycle=active&limit=12`);
    expect(listResponse.status).toBe(200);
    expect(ChannelListResponseSchema.parse(await listResponse.json())).toEqual(channels);
    expect(deps.listNotificationChannels).toHaveBeenCalledWith({ lifecycle: "active", limit: 12 });

    const createResponse = await fetch(`${baseUrl}/v1/channels`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Alerts",
        url: "https://hooks.example.test/opspulse",
        signingSecret: "x".repeat(32),
      }),
    });
    expect(createResponse.status).toBe(201);
    expect(ChannelResponseSchema.parse(await createResponse.json())).toEqual({ channel });
    expect(deps.createNotificationChannel).toHaveBeenCalledWith({
      name: "Alerts",
      url: "https://hooks.example.test/opspulse",
      signingSecret: "x".repeat(32),
      enabled: true,
    });

    const updateResponse = await fetch(`${baseUrl}/v1/channels/${channel.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Pager" }),
    });
    expect(updateResponse.status).toBe(200);
    expect(ChannelResponseSchema.parse(await updateResponse.json()).channel.name).toBe("Pager");
    expect(deps.updateNotificationChannel).toHaveBeenCalledWith(channel.id, { name: "Pager" });

    const archiveResponse = await fetch(`${baseUrl}/v1/channels/${channel.id}/archive`, {
      method: "POST",
    });
    expect(archiveResponse.status).toBe(200);
    expect(ChannelResponseSchema.parse(await archiveResponse.json()).channel.lifecycle).toBe(
      "archived",
    );
    expect(deps.archiveNotificationChannel).toHaveBeenCalledWith(channel.id);
  });

  it("attaches and detaches notification channels from monitors", async () => {
    const attachResponse = await fetch(
      `${baseUrl}/v1/monitors/${monitor.id}/channels/${channel.id}`,
      { method: "POST" },
    );
    expect(attachResponse.status).toBe(200);
    expect(ChannelResponseSchema.parse(await attachResponse.json())).toEqual({ channel });
    expect(deps.attachNotificationChannelToMonitor).toHaveBeenCalledWith(
      monitor.id,
      channel.id,
    );

    const detachResponse = await fetch(
      `${baseUrl}/v1/monitors/${monitor.id}/channels/${channel.id}`,
      { method: "DELETE" },
    );
    expect(detachResponse.status).toBe(200);
    expect(ChannelResponseSchema.parse(await detachResponse.json())).toEqual({ channel });
    expect(deps.detachNotificationChannelFromMonitor).toHaveBeenCalledWith(
      monitor.id,
      channel.id,
    );
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

  it("creates a heartbeat monitor and discloses the token once", async () => {
    const response = await fetch(`${baseUrl}/v1/monitors`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "heartbeat", name: "Nightly import" }),
    });
    const body = CreateMonitorResponseSchema.parse(await response.json());

    expect(response.status).toBe(201);
    expect(body).toEqual({ monitor: heartbeatMonitor, heartbeat: heartbeatCredentials });
    expect(deps.createHeartbeatMonitor).toHaveBeenCalledWith({
      kind: "heartbeat",
      name: "Nightly import",
      published: false,
      intervalSeconds: 60,
      failureThreshold: 2,
      recoveryThreshold: 1,
      gracePeriodSeconds: 60,
    } satisfies HeartbeatMonitorInput);
    expect(deps.createHttpMonitor).not.toHaveBeenCalled();
  });

  it("accepts heartbeat pings by token", async () => {
    const response = await fetch(`${baseUrl}/v1/heartbeats/${heartbeatToken}`, {
      method: "POST",
      headers: { "idempotency-key": "nightly-2026-07-22" },
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      checkId: "55555555-5555-4555-8555-555555555555",
      receivedAt: "2026-07-22T12:06:00.000Z",
      deduplicated: false,
    });
    expect(deps.recordHeartbeatPing).toHaveBeenCalledWith(heartbeatToken, {
      "idempotency-key": "nightly-2026-07-22",
    });
  });

  it("rotates a heartbeat token by monitor ID", async () => {
    const response = await fetch(`${baseUrl}/v1/monitors/${heartbeatMonitor.id}/heartbeat-token`, {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ...heartbeatCredentials,
      rotatedAt: "2026-07-22T12:05:00.000Z",
    });
    expect(deps.rotateHeartbeatToken).toHaveBeenCalledWith(heartbeatMonitor.id);
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

  it("hides check history when the monitor is missing or archived", async () => {
    deps.getMonitor = vi.fn(() => Promise.resolve(null));

    const response = await fetch(`${baseUrl}/v1/monitors/${monitor.id}/checks`);

    expect(response.status).toBe(404);
    expect(deps.listMonitorChecks).not.toHaveBeenCalled();
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
