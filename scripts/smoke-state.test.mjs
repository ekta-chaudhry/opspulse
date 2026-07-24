import { describe, expect, it } from "vitest";
import { parseSmokeState, validateVerticalSlice } from "./smoke-state.mjs";

const monitorId = "11111111-1111-4111-8111-111111111111";
const checkRequestId = "22222222-2222-4222-8222-222222222222";
const incidentId = "33333333-3333-4333-8333-333333333333";

const checks = (category = "dns", code = "ENOTFOUND") => ({
  items: [{
    request: { id: checkRequestId, monitorId, status: "completed" },
    run: { result: "failure", cause: { category, code } },
  }],
});
const incidents = {
  items: [{ id: incidentId, monitorId, status: "open" }],
};

describe("vertical slice smoke state", () => {
  it("requires the stable DNS classification instead of any generic failure", () => {
    expect(() => validateVerticalSlice(monitorId, checks("unknown", null), incidents)).toThrow(
      "DNS",
    );
    expect(validateVerticalSlice(monitorId, checks(), incidents)).toMatchObject({
      completedFailure: { request: { id: checkRequestId } },
      incident: { id: incidentId },
    });
  });

  it("verifies persisted IDs without accepting replacement rows", () => {
    const expected = { monitorId, checkRequestId, incidentId };
    expect(validateVerticalSlice(monitorId, checks(), incidents, expected)).not.toBeNull();
    expect(() => validateVerticalSlice(monitorId, checks(), incidents, {
      ...expected,
      checkRequestId: "44444444-4444-4444-8444-444444444444",
    })).toThrow("persisted check");
  });

  it("parses only secret-free UUID state", () => {
    expect(parseSmokeState(JSON.stringify({ monitorId, checkRequestId, incidentId }))).toEqual({
      monitorId,
      checkRequestId,
      incidentId,
    });
    expect(() => parseSmokeState(JSON.stringify({ monitorId, checkRequestId, incidentId, token: "x" }))).toThrow(
      "state",
    );
  });
});
