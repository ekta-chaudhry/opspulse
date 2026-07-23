import {
  FailureCauseSchema,
  type FailureCause,
} from "@opspulse/contracts";
import type {
  CompleteHttpCheckResult,
  HttpCheckOutcome,
  HttpCheckWorkItem,
} from "@opspulse/database";
import {
  executeSafeHttp,
  type SafeFailureCategory,
  type SafeHttpRequest,
  type SafeHttpResult,
} from "./safe-client.js";

export type CheckerDependencies = {
  execute(input: SafeHttpRequest): Promise<SafeHttpResult>;
  complete(requestId: string, outcome: HttpCheckOutcome): Promise<unknown>;
};

const summaries = {
  timeout: "HTTP check timed out",
  dns: "Target hostname could not be resolved",
  connection: "Connection to target failed",
  tls: "TLS connection to target failed",
  network: "Network request to target failed",
  unknown: "HTTP check failed unexpectedly",
} as const satisfies Record<SafeFailureCategory, string>;

function failureCause(
  category: SafeFailureCategory,
  code: string | null,
): FailureCause {
  return FailureCauseSchema.parse({
    category,
    code,
    httpStatus: null,
    safeSummary: summaries[category],
  });
}

function toOutcome(
  result: SafeHttpResult,
  acceptedStatus: { min: number; max: number },
): HttpCheckOutcome {
  if (result.ok) {
    if (result.status >= acceptedStatus.min && result.status <= acceptedStatus.max) {
      return {
        result: "success",
        httpStatus: result.status,
        latencyMs: result.latencyMs,
        cause: null,
      };
    }
    const cause = FailureCauseSchema.parse({
      category: "http_status",
      code: "HTTP_STATUS",
      httpStatus: result.status,
      safeSummary: "Target returned an unacceptable HTTP status",
    });
    return {
      result: "failure",
      httpStatus: result.status,
      latencyMs: result.latencyMs,
      cause,
    };
  }
  return {
    result: result.category === "timeout" ? "timeout" : "failure",
    httpStatus: null,
    latencyMs: result.latencyMs,
    cause: failureCause(result.category, result.code),
  };
}

export async function checkHttpMonitor(
  workItem: HttpCheckWorkItem,
  dependencies: CheckerDependencies,
): Promise<unknown> {
  let result: SafeHttpResult;
  try {
    result = await dependencies.execute({
      url: workItem.monitor.url,
      method: workItem.monitor.method,
      timeoutMs: workItem.monitor.timeoutSeconds * 1000,
      headers: workItem.monitor.headers,
    });
  } catch {
    result = { ok: false, category: "unknown", code: null, latencyMs: null };
  }
  const outcome = toOutcome(result, workItem.monitor.acceptedStatus);
  return dependencies.complete(workItem.request.id, outcome);
}

export type CompleteCheck = (
  requestId: string,
  outcome: HttpCheckOutcome,
) => Promise<CompleteHttpCheckResult>;

export const defaultCheckerDependencies = (complete: CompleteCheck): CheckerDependencies => ({
  execute: executeSafeHttp,
  complete,
});
