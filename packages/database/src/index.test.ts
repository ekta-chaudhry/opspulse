import { expect, it } from "vitest";
import {
  claimDueHttpCheck,
  completeHttpCheck,
  createHttpMonitor,
  getHttpMonitor,
  isStoredMonitor,
  listIncidents,
  listMonitorChecks,
} from "./index.js";

it("validates stored monitors through package boundaries", () => {
  expect(isStoredMonitor({ id: "m1", kind: "http" })).toBe(true);
  expect(isStoredMonitor({ id: "m2", kind: "smtp" })).toBe(false);
});

it("exports the HTTP persistence vertical slice", () => {
  expect([
    createHttpMonitor,
    getHttpMonitor,
    claimDueHttpCheck,
    completeHttpCheck,
    listMonitorChecks,
    listIncidents,
  ].every((value) => typeof value === "function")).toBe(true);
});
