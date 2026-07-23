/* global console, fetch, process, setTimeout */

const apiUrl = (process.env.API_URL ?? "http://api:3000").replace(/\/$/, "");
const deadline = Date.now() + 60_000;

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

async function waitForFailure(monitorId) {
  while (Date.now() < deadline) {
    const checks = await requestJson(`/v1/monitors/${monitorId}/checks?limit=10`);
    const incidents = await requestJson(
      `/v1/incidents?monitorId=${monitorId}&status=open&limit=10`,
    );
    const completedFailure = checks.items?.find(
      (item) => item.request?.status === "completed" && item.run?.result === "failure",
    );
    if (completedFailure !== undefined && incidents.items?.length === 1) {
      const incident = incidents.items[0];
      if (incident.status !== "open" || incident.monitorId !== monitorId) {
        throw new Error("Open incident did not match the monitor");
      }
      return { completedFailure, incident };
    }
    await sleep(250);
  }
  throw new Error("Completed DNS failure and open incident timed out");
}

async function main() {
  await waitForLiveness();
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
  console.log(JSON.stringify({
    monitorId,
    checkRequestId: completedFailure.request.id,
    checkStatus: completedFailure.request.status,
    checkResult: completedFailure.run.result,
    incidentId: incident.id,
    incidentStatus: incident.status,
  }));
}

main().catch(() => {
  console.error(JSON.stringify({ error: "vertical_slice_smoke_failed" }));
  process.exitCode = 1;
});
