import { expect, it } from "vitest";
import type { MonitorKind } from "./index.js";

it("exports the monitor kind boundary", () => {
  const kind: MonitorKind = "http";
  expect(kind).toBe("http");
});
