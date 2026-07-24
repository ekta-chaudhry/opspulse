import type { FailureCause } from "@opspulse/contracts";
import { describe, expect, it } from "vitest";
import { evaluateMonitorResult } from "./monitor-state.js";
import type { MonitorEvaluationSnapshot } from "./monitor-state.js";

const failureCause: FailureCause = {
  category: "connection",
  code: "ECONNREFUSED",
  httpStatus: null,
  safeSummary: "Connection refused",
};

const snapshot = (overrides: Record<string, unknown> = {}): MonitorEvaluationSnapshot =>
  ({
    state: "up",
    failureThreshold: 2,
    recoveryThreshold: 2,
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    hasOpenIncident: false,
    ...overrides,
  });

describe("evaluateMonitorResult", () => {
  it.each([
    {
      name: "opens on the first failure when the threshold is one",
      initial: snapshot({ failureThreshold: 1 }),
      result: { result: "failure" as const, cause: failureCause },
      expected: {
        nextSnapshot: {
          state: "down",
          consecutiveFailures: 1,
          consecutiveSuccesses: 0,
          hasOpenIncident: true,
        },
        transition: { type: "incident.open", cause: failureCause },
      },
    },
    {
      name: "degrades before a threshold of two",
      initial: snapshot(),
      result: { result: "failure" as const, cause: failureCause },
      expected: {
        nextSnapshot: {
          state: "degraded",
          consecutiveFailures: 1,
          consecutiveSuccesses: 0,
          hasOpenIncident: false,
        },
        transition: { type: "none" },
      },
    },
    {
      name: "opens on the second failure when the threshold is two",
      initial: snapshot({ state: "degraded", consecutiveFailures: 1 }),
      result: { result: "failure" as const, cause: failureCause },
      expected: {
        nextSnapshot: {
          state: "down",
          consecutiveFailures: 2,
          consecutiveSuccesses: 0,
          hasOpenIncident: true,
        },
        transition: { type: "incident.open", cause: failureCause },
      },
    },
    {
      name: "treats a timeout as a failure",
      initial: snapshot({ failureThreshold: 1, consecutiveSuccesses: 4 }),
      result: { result: "timeout" as const, cause: failureCause },
      expected: {
        nextSnapshot: {
          state: "down",
          consecutiveFailures: 1,
          consecutiveSuccesses: 0,
          hasOpenIncident: true,
        },
        transition: { type: "incident.open", cause: failureCause },
      },
    },
    {
      name: "observes a repeated failure",
      initial: snapshot({
        state: "down",
        consecutiveFailures: 2,
        hasOpenIncident: true,
      }),
      result: { result: "failure" as const, cause: failureCause },
      expected: {
        nextSnapshot: {
          state: "down",
          consecutiveFailures: 3,
          consecutiveSuccesses: 0,
          hasOpenIncident: true,
        },
        transition: {
          type: "incident.observe",
          previouslyOpen: true,
          cause: failureCause,
        },
      },
    },
    {
      name: "returns a pending monitor to up after success",
      initial: snapshot({ state: "pending", consecutiveFailures: 1 }),
      result: { result: "success" as const, cause: null },
      expected: {
        nextSnapshot: {
          state: "up",
          consecutiveFailures: 0,
          consecutiveSuccesses: 1,
          hasOpenIncident: false,
        },
        transition: { type: "none" },
      },
    },
    {
      name: "keeps an incident open during partial recovery",
      initial: snapshot({
        state: "down",
        recoveryThreshold: 2,
        consecutiveFailures: 2,
        hasOpenIncident: true,
      }),
      result: { result: "success" as const, cause: null },
      expected: {
        nextSnapshot: {
          state: "degraded",
          consecutiveFailures: 0,
          consecutiveSuccesses: 1,
          hasOpenIncident: true,
        },
        transition: { type: "none" },
      },
    },
    {
      name: "resolves an incident at the recovery threshold",
      initial: snapshot({
        state: "degraded",
        recoveryThreshold: 2,
        consecutiveSuccesses: 1,
        hasOpenIncident: true,
      }),
      result: { result: "success" as const, cause: null },
      expected: {
        nextSnapshot: {
          state: "up",
          consecutiveFailures: 0,
          consecutiveSuccesses: 0,
          hasOpenIncident: false,
        },
        transition: { type: "incident.resolve", reason: "recovered" },
      },
    },
  ])("$name", ({ initial, result, expected }) => {
    expect(evaluateMonitorResult(initial, result)).toEqual(expected);
  });

  it("resolves immediately when the recovery threshold is one", () => {
    expect(
      evaluateMonitorResult(
        snapshot({
          state: "down",
          recoveryThreshold: 1,
          consecutiveFailures: 1,
          hasOpenIncident: true,
        }),
        { result: "success", cause: null },
      ),
    ).toEqual({
      nextSnapshot: {
        state: "up",
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
        hasOpenIncident: false,
      },
      transition: { type: "incident.resolve", reason: "recovered" },
    });
  });

  it("observes a failure during partial recovery even before the failure threshold", () => {
    expect(
      evaluateMonitorResult(
        snapshot({
          state: "degraded",
          consecutiveSuccesses: 1,
          hasOpenIncident: true,
        }),
        { result: "failure", cause: failureCause },
      ),
    ).toEqual({
      nextSnapshot: {
        state: "degraded",
        consecutiveFailures: 1,
        consecutiveSuccesses: 0,
        hasOpenIncident: true,
      },
      transition: {
        type: "incident.observe",
        previouslyOpen: true,
        cause: failureCause,
      },
    });
  });

  it.each([
    {
      name: "successes",
      initial: snapshot({ consecutiveSuccesses: Number.MAX_SAFE_INTEGER }),
      result: { result: "success" as const, cause: null },
      expected: {
        state: "up",
        consecutiveFailures: 0,
        consecutiveSuccesses: Number.MAX_SAFE_INTEGER,
        hasOpenIncident: false,
      },
    },
    {
      name: "failures",
      initial: snapshot({
        state: "down",
        consecutiveFailures: Number.MAX_SAFE_INTEGER,
        hasOpenIncident: true,
      }),
      result: { result: "failure" as const, cause: failureCause },
      expected: {
        state: "down",
        consecutiveFailures: Number.MAX_SAFE_INTEGER,
        consecutiveSuccesses: 0,
        hasOpenIncident: true,
      },
    },
  ])("saturates consecutive $name", ({ initial, result, expected }) => {
    expect(evaluateMonitorResult(initial, result).nextSnapshot).toEqual(expected);
  });

  it.each([
    ["failureThreshold below one", snapshot({ failureThreshold: 0 }), RangeError],
    ["failureThreshold above ten", snapshot({ failureThreshold: 11 }), RangeError],
    ["non-integer recoveryThreshold", snapshot({ recoveryThreshold: 1.5 }), RangeError],
    ["negative failures", snapshot({ consecutiveFailures: -1 }), RangeError],
    [
      "unsafe successes",
      snapshot({ consecutiveSuccesses: Number.MAX_SAFE_INTEGER + 1 }),
      RangeError,
    ],
    ["non-number threshold", snapshot({ failureThreshold: "2" }), TypeError],
    ["unknown state", snapshot({ state: "paused" }), TypeError],
    ["non-boolean incident marker", snapshot({ hasOpenIncident: 1 }), TypeError],
    ["pending with an open incident", snapshot({ state: "pending", hasOpenIncident: true }), RangeError],
    ["up with an open incident", snapshot({ hasOpenIncident: true }), RangeError],
    ["down without an open incident", snapshot({ state: "down" }), RangeError],
  ])("rejects $0", (_name, invalidSnapshot, ErrorType) => {
    expect(() =>
      evaluateMonitorResult(invalidSnapshot, { result: "success", cause: null }),
    ).toThrow(ErrorType);
  });
});
