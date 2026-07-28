/* global AbortController, clearTimeout, console, fetch, process, setTimeout */

import { pathToFileURL } from "node:url";

export const API_URL = (process.env.API_URL ?? "http://api:3000").replace(/\/$/, "");
export const DASHBOARD_URL = process.env.DASHBOARD_URL ?? "http://127.0.0.1:3000";

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function withDeadline(timeoutMs, timeoutError, operation) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(timeoutError));
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function responseItems(response, phase) {
  if (typeof response !== "object" || response === null || !Array.isArray(response.items)) {
    throw new Error(`${phase} response was invalid`);
  }
  return response.items;
}

export function findFailedCheck(monitorId, checks) {
  const completed = responseItems(checks, "Check").filter(
    (item) => item?.request?.status === "completed",
  );
  if (completed.length === 0) return null;

  const check = completed[0];
  if (check.request.monitorId !== monitorId) {
    throw new Error("Completed check did not match monitor");
  }
  if (
    check.run?.result !== "failure" ||
    check.run.cause?.category !== "dns" ||
    check.run.cause?.code !== "ENOTFOUND"
  ) {
    throw new Error("Completed check was not a DNS/ENOTFOUND failure");
  }
  if (typeof check.request.id !== "string") {
    throw new Error("Completed DNS failure was invalid");
  }
  return {
    checkRequestId: check.request.id,
    result: "failure",
    cause: "dns/ENOTFOUND",
  };
}

export function findOpenIncident(monitorId, incidents) {
  const open = responseItems(incidents, "Incident").filter(
    (incident) => incident?.status === "open",
  );
  if (open.length === 0) return null;
  if (open.length !== 1) throw new Error("Expected exactly one open incident");
  if (open[0].monitorId !== monitorId) {
    throw new Error("Open incident did not match monitor");
  }
  if (typeof open[0].id !== "string") {
    throw new Error("Open incident was invalid");
  }
  return { incidentId: open[0].id };
}

async function poll(load, select, timeoutError, {
  timeoutMs = 60_000,
  intervalMs = 250,
  now = Date.now,
  sleep: wait = sleep,
} = {}) {
  return withDeadline(timeoutMs, timeoutError, async (signal) => {
    const deadline = now() + timeoutMs;
    while (true) {
      if (signal.aborted) throw new Error(timeoutError);
      let loaded = false;
      let response;
      try {
        response = await load(signal);
        loaded = true;
      } catch {
        // Transient API failures remain private while the bounded poll retries.
      }
      if (loaded) {
        const result = select(response);
        if (result !== null) return result;
      }
      if (signal.aborted || now() >= deadline) throw new Error(timeoutError);
      await wait(intervalMs);
    }
  });
}

export function waitForFailedCheck(monitorId, loadChecks, options) {
  return poll(
    loadChecks,
    (checks) => findFailedCheck(monitorId, checks),
    "DNS failure timed out",
    options,
  );
}

export function waitForOpenIncident(monitorId, loadIncidents, options) {
  return poll(
    loadIncidents,
    (incidents) => findOpenIncident(monitorId, incidents),
    "Open incident timed out",
    options,
  );
}

export async function waitForLiveness(loadLiveness, {
  timeoutMs = 60_000,
  intervalMs = 250,
  now = Date.now,
  sleep: wait = sleep,
} = {}) {
  return withDeadline(timeoutMs, "API liveness timed out", async (signal) => {
    const deadline = now() + timeoutMs;
    while (true) {
      if (signal.aborted) throw new Error("API liveness timed out");
      try {
        if ((await loadLiveness(signal))?.status === "alive") return;
      } catch {
        // API startup failures remain private while the bounded wait retries.
      }
      if (signal.aborted || now() >= deadline) throw new Error("API liveness timed out");
      await wait(intervalMs);
    }
  });
}

export function createScenarioMonitor(createMonitor, { timeoutMs = 60_000 } = {}) {
  return withDeadline(timeoutMs, "Monitor creation failed", async (signal) => {
    try {
      const response = await createMonitor({
        kind: "http",
        name: "Payments API",
        url: "http://does-not-exist.invalid/",
        method: "GET",
        failureThreshold: 1,
      }, signal);
      if (typeof response?.monitor?.id !== "string") throw new Error("invalid response");
      return response.monitor.id;
    } catch {
      throw new Error("Monitor creation failed");
    }
  });
}

async function requestJson(apiUrl, path, init, fetchImpl) {
  const response = await fetchImpl(`${apiUrl}${path}`, init);
  if (!response.ok) {
    throw new Error(`API request failed with status ${String(response.status)}`);
  }
  return response.json();
}

export async function runFailureScenario({
  apiUrl = API_URL,
  dashboardUrl = DASHBOARD_URL,
  fetchImpl = fetch,
  loadLiveness,
  createMonitor,
  loadChecks,
  loadIncidents,
  timeoutMs = 60_000,
  intervalMs = 250,
  now = Date.now,
  sleep: wait = sleep,
} = {}) {
  const request = (path, init) => requestJson(apiUrl, path, init, fetchImpl);
  const polling = { timeoutMs, intervalMs, now, sleep: wait };

  await waitForLiveness(
    loadLiveness ?? ((signal) => request("/health/live", { signal })),
    polling,
  );
  const monitorId = await createScenarioMonitor(
    createMonitor ?? ((input, signal) => request("/v1/monitors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal,
    })),
    { timeoutMs },
  );
  const failedCheck = await waitForFailedCheck(
    monitorId,
    loadChecks ?? ((signal) => request(
      `/v1/monitors/${monitorId}/checks?limit=10`,
      { signal },
    )),
    polling,
  );
  const incident = await waitForOpenIncident(
    monitorId,
    loadIncidents ?? ((signal) => request(
      `/v1/incidents?monitorId=${monitorId}&status=open&limit=10`,
      { signal },
    )),
    polling,
  );

  return {
    dashboardUrl,
    monitorId,
    checkRequestId: failedCheck.checkRequestId,
    incidentId: incident.incidentId,
    result: failedCheck.result,
    cause: failedCheck.cause,
  };
}

const isDirectExecution = process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  runFailureScenario().then((result) => {
    console.log(JSON.stringify(result));
  }).catch((error) => {
    const message = error instanceof Error ? error.message : "Failure scenario failed";
    console.error(message);
    process.exitCode = 1;
  });
}
