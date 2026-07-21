import { expect, it } from "vitest";
import { isStoredMonitor } from "./index.js";

it("validates stored monitors through package boundaries", () => {
  expect(isStoredMonitor({ id: "m1", kind: "http" })).toBe(true);
  expect(isStoredMonitor({ id: "m2", kind: "smtp" })).toBe(false);
});
