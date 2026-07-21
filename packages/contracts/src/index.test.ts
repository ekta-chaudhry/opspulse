import { expectTypeOf, it } from "vitest";
import type { MonitorKind } from "./index.js";

it("exports the monitor kind boundary", () => {
  expectTypeOf<MonitorKind>().toEqualTypeOf<"http" | "heartbeat">();
});
