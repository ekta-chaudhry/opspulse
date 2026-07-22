import type { FailureCause, MonitorState } from "@opspulse/contracts";

export type MonitorEvaluationSnapshot = {
  state: MonitorState;
  failureThreshold: number;
  recoveryThreshold: number;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  hasOpenIncident: boolean;
};

export type MonitorEvaluationResult =
  | { result: "success"; cause: null }
  | { result: "failure" | "timeout"; cause: FailureCause };

export type MonitorNextSnapshot = Pick<
  MonitorEvaluationSnapshot,
  "state" | "consecutiveFailures" | "consecutiveSuccesses" | "hasOpenIncident"
>;

export type MonitorTransition =
  | { type: "none" }
  | { type: "incident.open"; cause: FailureCause }
  | { type: "incident.observe"; previouslyOpen: true; cause: FailureCause }
  | { type: "incident.resolve"; reason: "recovered" };

export type MonitorEvaluation = {
  nextSnapshot: MonitorNextSnapshot;
  transition: MonitorTransition;
};

function assertThreshold(name: string, value: unknown): asserts value is number {
  if (typeof value !== "number") {
    throw new TypeError(`${name} must be a number`);
  }
  if (!Number.isInteger(value) || value < 1 || value > 10) {
    throw new RangeError(`${name} must be an integer from 1 to 10`);
  }
}

function assertCounter(name: string, value: unknown): asserts value is number {
  if (typeof value !== "number") {
    throw new TypeError(`${name} must be a number`);
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a nonnegative safe integer`);
  }
}

function validateSnapshot(snapshot: unknown): asserts snapshot is MonitorEvaluationSnapshot {
  if (typeof snapshot !== "object" || snapshot === null) {
    throw new TypeError("snapshot must be an object");
  }
  const candidate = snapshot as Record<string, unknown>;
  if (
    candidate.state !== "pending" &&
    candidate.state !== "up" &&
    candidate.state !== "degraded" &&
    candidate.state !== "down"
  ) {
    throw new TypeError("state must be pending, up, degraded, or down");
  }
  assertThreshold("failureThreshold", candidate.failureThreshold);
  assertThreshold("recoveryThreshold", candidate.recoveryThreshold);
  assertCounter("consecutiveFailures", candidate.consecutiveFailures);
  assertCounter("consecutiveSuccesses", candidate.consecutiveSuccesses);
  if (typeof candidate.hasOpenIncident !== "boolean") {
    throw new TypeError("hasOpenIncident must be a boolean");
  }
  if (candidate.hasOpenIncident && (candidate.state === "pending" || candidate.state === "up")) {
    throw new RangeError(`${candidate.state} state cannot have an open incident`);
  }
  if (candidate.state === "down" && !candidate.hasOpenIncident) {
    throw new RangeError("down state must have an open incident");
  }
}

const increment = (value: number): number =>
  value === Number.MAX_SAFE_INTEGER ? value : value + 1;

export const evaluateMonitorResult = (
  snapshot: MonitorEvaluationSnapshot,
  result: MonitorEvaluationResult,
): MonitorEvaluation => {
  validateSnapshot(snapshot);

  if (result.result === "success") {
    const consecutiveSuccesses = increment(snapshot.consecutiveSuccesses);
    if (!snapshot.hasOpenIncident) {
      return {
        nextSnapshot: {
          state: "up",
          consecutiveFailures: 0,
          consecutiveSuccesses,
          hasOpenIncident: false,
        },
        transition: { type: "none" },
      };
    }
    if (consecutiveSuccesses >= snapshot.recoveryThreshold) {
      return {
        nextSnapshot: {
          state: "up",
          consecutiveFailures: 0,
          consecutiveSuccesses: 0,
          hasOpenIncident: false,
        },
        transition: { type: "incident.resolve", reason: "recovered" },
      };
    }
    return {
      nextSnapshot: {
        state: "degraded",
        consecutiveFailures: 0,
        consecutiveSuccesses,
        hasOpenIncident: true,
      },
      transition: { type: "none" },
    };
  }

  const consecutiveFailures = increment(snapshot.consecutiveFailures);
  const reachedThreshold = consecutiveFailures >= snapshot.failureThreshold;
  const state = reachedThreshold || snapshot.state === "down" ? "down" : "degraded";
  const nextSnapshot: MonitorNextSnapshot = {
    state,
    consecutiveFailures,
    consecutiveSuccesses: 0,
    hasOpenIncident: snapshot.hasOpenIncident || reachedThreshold,
  };

  if (snapshot.hasOpenIncident) {
    return {
      nextSnapshot,
      transition: {
        type: "incident.observe",
        previouslyOpen: true,
        cause: result.cause,
      },
    };
  }
  if (reachedThreshold) {
    return {
      nextSnapshot,
      transition: { type: "incident.open", cause: result.cause },
    };
  }
  return { nextSnapshot, transition: { type: "none" } };
};
