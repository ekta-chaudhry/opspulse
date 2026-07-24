import { describe, expect, it } from "vitest";
import { parseWorkerConfig } from "./config.js";

describe("parseWorkerConfig", () => {
  it("requires DATABASE_URL and defaults polling to 500ms", () => {
    expect(parseWorkerConfig({ DATABASE_URL: "postgresql://localhost/opspulse" })).toEqual({
      databaseUrl: "postgresql://localhost/opspulse",
      pollIntervalMs: 500,
    });
    expect(() => parseWorkerConfig({})).toThrow("DATABASE_URL");
  });

  it.each(["0", "60001", "1.5", "not-a-number"])(
    "rejects invalid POLL_INTERVAL_MS %s",
    (pollIntervalMs) => {
      expect(() =>
        parseWorkerConfig({
          DATABASE_URL: "postgresql://localhost/opspulse",
          POLL_INTERVAL_MS: pollIntervalMs,
        }),
      ).toThrow("POLL_INTERVAL_MS");
    },
  );
});
