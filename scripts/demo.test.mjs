/* global AbortSignal, structuredClone */

import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import {
  API_URL,
  DASHBOARD_URL,
  createDemoMonitor,
  findFailedCheck,
  findOpenIncident,
  runDemo,
  waitForFailedCheck,
  waitForLiveness,
  waitForOpenIncident,
} from "./demo.mjs";

const monitorId = "11111111-1111-4111-8111-111111111111";
const checkRequestId = "22222222-2222-4222-8222-222222222222";
const incidentId = "33333333-3333-4333-8333-333333333333";

const completedDnsFailure = {
  items: [{
    request: { id: checkRequestId, monitorId, status: "completed" },
    run: {
      result: "failure",
      cause: { category: "dns", code: "ENOTFOUND" },
      rawError: "getaddrinfo ENOTFOUND does-not-exist.invalid",
    },
    config: { url: "http://does-not-exist.invalid/", headers: [{ name: "secret" }] },
  }],
};
const pendingChecks = {
  items: [{ request: { id: checkRequestId, monitorId, status: "pending" }, run: null }],
};
const openIncident = {
  items: [{ id: incidentId, monitorId, status: "open" }],
};

describe("recruiter demo selection", () => {
  it("selects and sanitizes a completed DNS failure for the created monitor", () => {
    expect(findFailedCheck(monitorId, completedDnsFailure)).toEqual({
      checkRequestId,
      result: "failure",
      cause: "dns/ENOTFOUND",
    });
    expect(JSON.stringify(findFailedCheck(monitorId, completedDnsFailure))).not.toMatch(
      /url|headers|raw|does-not-exist/i,
    );
  });

  it("returns null while the check is pending", () => {
    expect(findFailedCheck(monitorId, pendingChecks)).toBeNull();
    expect(findFailedCheck(monitorId, { items: [] })).toBeNull();
  });

  it("rejects completed check data for another monitor or another result", () => {
    const mismatched = structuredClone(completedDnsFailure);
    mismatched.items[0].request.monitorId = "44444444-4444-4444-8444-444444444444";
    expect(() => findFailedCheck(monitorId, mismatched)).toThrow();

    const invalid = structuredClone(completedDnsFailure);
    invalid.items[0].run.cause.code = "ECONNREFUSED";
    expect(() => findFailedCheck(monitorId, invalid)).toThrow();

    const missingId = structuredClone(completedDnsFailure);
    delete missingId.items[0].request.id;
    expect(() => findFailedCheck(monitorId, missingId)).toThrow();
  });

  it("selects exactly one sanitized open incident for the created monitor", () => {
    expect(findOpenIncident(monitorId, openIncident)).toEqual({ incidentId });
    expect(findOpenIncident(monitorId, { items: [] })).toBeNull();
    expect(findOpenIncident(monitorId, {
      items: [{ id: incidentId, monitorId, status: "resolved" }],
    })).toBeNull();
  });

  it("rejects mismatched, duplicate, or invalid open incidents", () => {
    expect(() => findOpenIncident(monitorId, {
      items: [{ id: incidentId, monitorId: "44444444-4444-4444-8444-444444444444", status: "open" }],
    })).toThrow();
    expect(() => findOpenIncident(monitorId, {
      items: [openIncident.items[0], { ...openIncident.items[0], id: checkRequestId }],
    })).toThrow();
    expect(() => findOpenIncident(monitorId, {
      items: [{ monitorId, status: "open" }],
    })).toThrow();
  });
});

describe("recruiter demo phases", () => {
  it("aborts never-resolving loaders at each phase deadline", async () => {
    const signals = [];
    const neverResolves = (signal) => {
      signals.push(signal);
      return new Promise(() => {});
    };
    const outcomes = await Promise.race([
      Promise.all([
        waitForLiveness(neverResolves, { timeoutMs: 10 }),
        createDemoMonitor((_input, signal) => neverResolves(signal), Date.now, {
          timeoutMs: 10,
        }),
        waitForFailedCheck(monitorId, neverResolves, { timeoutMs: 10 }),
        waitForOpenIncident(monitorId, neverResolves, { timeoutMs: 10 }),
      ].map((phase) => phase.catch((error) => error.message))),
      delay(250, null),
    ]);

    expect(outcomes).toEqual([
      "API liveness timed out",
      "Monitor creation failed",
      "DNS failure timed out",
      "Open incident timed out",
    ]);
    expect(signals).toHaveLength(4);
    expect(signals.every((signal) => signal instanceof AbortSignal && signal.aborted)).toBe(true);
  });

  it("polls check completion independently with an injected loader", async () => {
    let clock = 0;
    const loadChecks = vi.fn()
      .mockResolvedValueOnce(pendingChecks)
      .mockResolvedValueOnce(completedDnsFailure);

    await expect(waitForFailedCheck(monitorId, loadChecks, {
      timeoutMs: 10,
      intervalMs: 1,
      now: () => clock,
      sleep: async (milliseconds) => { clock += milliseconds; },
    })).resolves.toEqual({ checkRequestId, result: "failure", cause: "dns/ENOTFOUND" });
    expect(loadChecks).toHaveBeenCalledTimes(2);
  });

  it("uses a stable check-completion timeout", async () => {
    await expect(waitForFailedCheck(monitorId, async () => pendingChecks, {
      timeoutMs: 0,
    })).rejects.toMatchObject({ message: "DNS failure timed out" });
  });

  it("keeps check loader failures private until the bounded timeout", async () => {
    await expect(waitForFailedCheck(monitorId, async () => {
      throw new Error("private check loader error");
    }, {
      timeoutMs: 0,
    })).rejects.toMatchObject({ message: "DNS failure timed out" });
  });

  it("polls incident creation independently with an injected loader", async () => {
    let clock = 0;
    const loadIncidents = vi.fn()
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce(openIncident);

    await expect(waitForOpenIncident(monitorId, loadIncidents, {
      timeoutMs: 10,
      intervalMs: 1,
      now: () => clock,
      sleep: async (milliseconds) => { clock += milliseconds; },
    })).resolves.toEqual({ incidentId });
    expect(loadIncidents).toHaveBeenCalledTimes(2);
  });

  it("uses a stable incident-creation timeout", async () => {
    await expect(waitForOpenIncident(monitorId, async () => ({ items: [] }), {
      timeoutMs: 0,
    })).rejects.toMatchObject({ message: "Open incident timed out" });
  });

  it("keeps incident loader failures private until the bounded timeout", async () => {
    await expect(waitForOpenIncident(monitorId, async () => {
      throw new Error("private incident loader error");
    }, {
      timeoutMs: 0,
    })).rejects.toMatchObject({ message: "Open incident timed out" });
  });

  it("retries liveness safely and reports only its phase timeout", async () => {
    const rawError = "postgresql://owner:secret@private-db/opspulse";
    await expect(waitForLiveness(async () => { throw new Error(rawError); }, {
      timeoutMs: 0,
    })).rejects.toMatchObject({ message: "API liveness timed out" });
  });

  it("creates the required monitor and safely wraps creation failures", async () => {
    const now = () => Date.parse("2026-07-27T12:34:56.789Z");
    const createMonitor = vi.fn().mockResolvedValue({ monitor: { id: monitorId } });
    await expect(createDemoMonitor(createMonitor, now)).resolves.toBe(monitorId);
    expect(createMonitor).toHaveBeenCalledWith(
      {
        kind: "http",
        name: "Resume demo 2026-07-27T12:34:56.789Z",
        url: "http://does-not-exist.invalid/",
        method: "GET",
        failureThreshold: 1,
      },
      expect.any(AbortSignal),
    );

    await expect(createDemoMonitor(async () => {
      throw new Error("request headers and target leaked");
    }, now)).rejects.toMatchObject({ message: "Monitor creation failed" });
  });

  it("returns only the compact safe demo result", async () => {
    const result = await runDemo({
      dashboardUrl: "http://dashboard.test",
      loadLiveness: async () => ({ status: "alive" }),
      createMonitor: async () => ({ monitor: { id: monitorId } }),
      loadChecks: async () => completedDnsFailure,
      loadIncidents: async () => openIncident,
    });

    expect(result).toEqual({
      dashboardUrl: "http://dashboard.test",
      monitorId,
      checkRequestId,
      incidentId,
      result: "failure",
      cause: "dns/ENOTFOUND",
    });
    expect(Object.keys(result)).toEqual([
      "dashboardUrl",
      "monitorId",
      "checkRequestId",
      "incidentId",
      "result",
      "cause",
    ]);
  });

  it("uses internal API and host-facing dashboard defaults", () => {
    expect(API_URL).toBe("http://api:3000");
    expect(DASHBOARD_URL).toBe("http://127.0.0.1:3000");
  });
});
