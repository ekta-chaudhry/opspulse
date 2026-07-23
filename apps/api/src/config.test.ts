import { describe, expect, it } from "vitest";
import { parseApiConfig } from "./config.js";

describe("parseApiConfig", () => {
  it("requires DATABASE_URL and applies local server defaults", () => {
    expect(parseApiConfig({ DATABASE_URL: "postgresql://localhost/opspulse" })).toEqual({
      databaseUrl: "postgresql://localhost/opspulse",
      host: "0.0.0.0",
      port: 3000,
    });
    expect(() => parseApiConfig({})).toThrow("DATABASE_URL");
  });

  it.each(["0", "65536", "1.5", "not-a-port"])("rejects invalid PORT %s", (port) => {
    expect(() =>
      parseApiConfig({ DATABASE_URL: "postgresql://localhost/opspulse", PORT: port }),
    ).toThrow("PORT");
  });
});
