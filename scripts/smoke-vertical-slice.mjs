/* global console, fetch, process, setTimeout */

import { readFile, writeFile } from "node:fs/promises";
import { parseSmokeState, validateVerticalSlice } from "./smoke-state.mjs";

const apiUrl = (process.env.API_URL ?? "http://api:3000").replace(/\/$/, "");
const stateFile = process.env.SMOKE_STATE_FILE ?? "/state/vertical-slice.json";
const verifyExisting = process.env.VERIFY_EXISTING === "1";

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function requestJson(path, init) {
  const response = await fetch(`${apiUrl}${path}`, init);
  if (!response.ok) {
    throw new Error(`API request failed with status ${String(response.status)}`);
  }
  return response.json();
}

async function verifyDashboard(monitorId) {
  const response = await fetch(`${apiUrl}/`);
  if (!response.ok || !(response.headers.get("content-type") ?? "").includes("text/html")) {
    throw new Error("Dashboard shell was not available");
  }
  const html = await response.text();
  if (!html.includes('id="monitors"') || !html.includes('id="recent-checks"')) {
    throw new Error("Dashboard shell was incomplete");
  }
  if (monitorId !== undefined) {
    const monitors = await requestJson("/v1/monitors?limit=100");
    if (!monitors.items?.some((monitor) => monitor.id === monitorId)) {
      throw new Error("Monitor listing did not include the smoke monitor");
    }
  }
}

async function waitForLiveness() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const health = await requestJson("/health/live");
      if (health.status === "alive") return;
    } catch {
      // Startup races are expected while Compose is satisfying dependencies.
    }
    await sleep(250);
  }
  throw new Error("API liveness timed out");
}

async function waitForFailure(monitorId, expected, expectedGeneration) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const checks = await requestJson(`/v1/monitors/${monitorId}/checks?limit=10`);
    const incidents = await requestJson(
      `/v1/incidents?monitorId=${monitorId}&status=open&limit=10`,
    );
    const result = validateVerticalSlice(monitorId, checks, incidents, expected);
    if (result !== null) {
      if (
        expectedGeneration !== undefined &&
        result.completedFailure.request.generation !== expectedGeneration
      ) {
        await sleep(250);
        continue;
      }
      const recentChecks = await requestJson("/v1/checks?limit=100");
      if (recentChecks.items?.some((item) => item.request?.id === result.completedFailure.request.id)) {
        return result;
      }
    }
    await sleep(250);
  }
  throw new Error("Completed DNS failure and open incident timed out");
}

async function verifyMonitorManagement() {
  const created = await requestJson("/v1/monitors", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "http",
      name: "Compose lifecycle smoke",
      url: "http://does-not-exist.invalid/",
      method: "GET",
      failureThreshold: 1,
    }),
  });
  const monitorId = created.monitor?.id;
  if (typeof monitorId !== "string") {
    throw new Error("Lifecycle smoke monitor did not contain an ID");
  }
  const detail = await requestJson(`/v1/monitors/${monitorId}`);
  if (detail.monitor?.lifecycle !== "active") {
    throw new Error("New lifecycle smoke monitor was not active");
  }
  const initialGeneration = detail.monitor.generation;
  const descriptivelyUpdated = await requestJson(`/v1/monitors/${monitorId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "http",
      name: "Compose edited lifecycle smoke",
      published: false,
    }),
  });
  if (
    descriptivelyUpdated.monitor?.name !== "Compose edited lifecycle smoke" ||
    descriptivelyUpdated.monitor?.generation !== initialGeneration
  ) {
    throw new Error("Descriptive monitor update reset scheduled work");
  }
  const rescheduled = await requestJson(`/v1/monitors/${monitorId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "http",
      url: "http://schedule-change.invalid/",
      intervalSeconds: 30,
    }),
  });
  if (
    rescheduled.monitor?.generation !== initialGeneration + 1 ||
    rescheduled.monitor?.nextSequence !== 1 ||
    rescheduled.monitor?.lastEvaluatedSequence !== 0 ||
    typeof rescheduled.monitor?.nextCheckAt !== "string"
  ) {
    throw new Error("Schedule-affecting monitor update did not initialize fresh work");
  }
  await waitForFailure(monitorId, undefined, rescheduled.monitor.generation);
  const paused = await requestJson(`/v1/monitors/${monitorId}/pause`, { method: "POST" });
  if (paused.monitor?.lifecycle !== "paused") {
    throw new Error("Monitor pause did not persist");
  }
  const resumed = await requestJson(`/v1/monitors/${monitorId}/resume`, { method: "POST" });
  if (resumed.monitor?.lifecycle !== "active" || resumed.monitor?.state !== "pending") {
    throw new Error("Monitor resume did not initialize fresh work");
  }
  const archived = await requestJson(`/v1/monitors/${monitorId}/archive`, { method: "POST" });
  if (archived.monitor?.lifecycle !== "archived") {
    throw new Error("Monitor archive did not persist");
  }
  const archivedDetail = await fetch(`${apiUrl}/v1/monitors/${monitorId}`);
  if (archivedDetail.status !== 404) {
    throw new Error("Archived monitor remained available through detail API");
  }
  const incidents = await requestJson(
    `/v1/incidents?monitorId=${monitorId}&status=resolved&limit=10`,
  );
  if (!incidents.items?.some((incident) =>
    incident.resolutionReason === "monitor_archived"
  )) {
    throw new Error("Archiving did not resolve the open incident");
  }
  return monitorId;
}

async function main() {
  await waitForLiveness();
  await verifyDashboard();
  if (verifyExisting) {
    const state = parseSmokeState(await readFile(stateFile, "utf8"));
    await verifyDashboard(state.monitorId);
    const { completedFailure, incident } = await waitForFailure(state.monitorId, state);
    console.log(JSON.stringify({
      mode: "verify-existing",
      monitorId: state.monitorId,
      checkRequestId: completedFailure.request.id,
      checkStatus: completedFailure.request.status,
      checkResult: completedFailure.run.result,
      causeCategory: completedFailure.run.cause.category,
      causeCode: completedFailure.run.cause.code,
      incidentId: incident.id,
      incidentStatus: incident.status,
    }));
    return;
  }

  const created = await requestJson("/v1/monitors", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "http",
      name: "Compose DNS failure smoke",
      url: "http://does-not-exist.invalid/",
      method: "GET",
      failureThreshold: 1,
    }),
  });
  const monitorId = created.monitor?.id;
  if (typeof monitorId !== "string") {
    throw new Error("Create monitor response did not contain an ID");
  }
  await verifyDashboard(monitorId);

  const { completedFailure, incident } = await waitForFailure(monitorId);
  const lifecycleMonitorId = await verifyMonitorManagement();
  await writeFile(
    stateFile,
    JSON.stringify({
      monitorId,
      checkRequestId: completedFailure.request.id,
      incidentId: incident.id,
    }),
    { encoding: "utf8", mode: 0o600 },
  );
  console.log(JSON.stringify({
    mode: "initial",
    monitorId,
    checkRequestId: completedFailure.request.id,
    checkStatus: completedFailure.request.status,
    checkResult: completedFailure.run.result,
    causeCategory: completedFailure.run.cause.category,
    causeCode: completedFailure.run.cause.code,
    incidentId: incident.id,
    incidentStatus: incident.status,
    lifecycleMonitorId,
    lifecycleStatus: "archived",
  }));
}

main().catch(() => {
  console.error(JSON.stringify({ error: "vertical_slice_smoke_failed" }));
  process.exitCode = 1;
});
