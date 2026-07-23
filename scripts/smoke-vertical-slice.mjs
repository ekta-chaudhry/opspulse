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

async function waitForFailure(monitorId, expected) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const checks = await requestJson(`/v1/monitors/${monitorId}/checks?limit=10`);
    const incidents = await requestJson(
      `/v1/incidents?monitorId=${monitorId}&status=open&limit=10`,
    );
    const result = validateVerticalSlice(monitorId, checks, incidents, expected);
    if (result !== null) return result;
    await sleep(250);
  }
  throw new Error("Completed DNS failure and open incident timed out");
}

async function main() {
  await waitForLiveness();
  if (verifyExisting) {
    const state = parseSmokeState(await readFile(stateFile, "utf8"));
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

  const { completedFailure, incident } = await waitForFailure(monitorId);
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
  }));
}

main().catch(() => {
  console.error(JSON.stringify({ error: "vertical_slice_smoke_failed" }));
  process.exitCode = 1;
});
