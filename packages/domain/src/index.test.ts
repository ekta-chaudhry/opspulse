import { expect, it } from "vitest";
import { isMonitorKind } from "./index.js";

it.each<[string, boolean]>([
  ["http", true],
  ["heartbeat", true],
  ["smtp", false],
])("classifies %s", (value, expected) => {
  expect(isMonitorKind(value)).toBe(expected);
});
