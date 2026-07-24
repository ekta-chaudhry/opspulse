const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isSmokeState(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 3 &&
    keys.every((key) => ["monitorId", "checkRequestId", "incidentId"].includes(key)) &&
    uuidPattern.test(value.monitorId) &&
    uuidPattern.test(value.checkRequestId) &&
    uuidPattern.test(value.incidentId);
}

export function parseSmokeState(text) {
  try {
    const value = JSON.parse(text);
    if (!isSmokeState(value)) throw new Error("invalid state");
    return value;
  } catch {
    throw new Error("Smoke state is invalid");
  }
}

export function validateVerticalSlice(monitorId, checks, incidents, expected) {
  const completedFailures = checks.items?.filter(
    (item) => item.request?.status === "completed" && item.run?.result === "failure",
  ) ?? [];
  const completedFailure = expected === undefined
    ? completedFailures[0]
    : completedFailures.find((item) => item.request.id === expected.checkRequestId);
  if (completedFailure === undefined) {
    if (expected !== undefined && completedFailures.length > 0) {
      throw new Error("Expected persisted check was not returned");
    }
    return null;
  }
  if (
    completedFailure.request.monitorId !== monitorId ||
    completedFailure.run.cause?.category !== "dns" ||
    completedFailure.run.cause?.code !== "ENOTFOUND"
  ) {
    throw new Error("Completed failure did not have the expected DNS classification");
  }

  const openIncidents = incidents.items?.filter(
    (incident) => incident.status === "open" && incident.monitorId === monitorId,
  ) ?? [];
  if (openIncidents.length === 0) return null;
  if (openIncidents.length !== 1) throw new Error("Expected exactly one open incident");
  const incident = openIncidents[0];
  if (expected !== undefined && incident.id !== expected.incidentId) {
    throw new Error("Expected persisted incident was not returned");
  }
  return { completedFailure, incident };
}
