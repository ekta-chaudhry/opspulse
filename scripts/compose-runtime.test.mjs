/* global URL */

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);

describe("Compose runtime safeguards", () => {
  it("allows API and worker enough time for a maximum-duration request to stop", async () => {
    const compose = await readFile(new URL("compose.yaml", root), "utf8");
    expect(compose.match(/stop_grace_period: 45s/g)).toHaveLength(2);
  });

  it("keeps external API binding local while mounting persistent smoke state", async () => {
    const compose = await readFile(new URL("compose.yaml", root), "utf8");
    expect(compose).toContain("HOST: 0.0.0.0");
    expect(compose).toContain('127.0.0.1:3000:3000');
    expect(compose).toContain("smoke-state:/state");
  });
});
