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

  it("wires an isolated failure scenario through the healthy internal API", async () => {
    const compose = await readFile(new URL("compose.yaml", root), "utf8");
    const scenario = /\n {2}failure-scenario:\n([\s\S]*?)\n\nvolumes:/.exec(compose)?.[1];

    expect(scenario).toBeDefined();
    expect(scenario).toContain('profiles: ["scenario"]');
    expect(scenario).toContain("API_URL: http://api:3000");
    expect(scenario).toContain("DASHBOARD_URL: http://127.0.0.1:3000");
    expect(scenario).toContain('command: ["node", "scripts/failure-scenario.mjs"]');
    expect(scenario).toContain("condition: service_healthy");
    expect(scenario).not.toMatch(/^\s+volumes:/m);
    expect(scenario).not.toMatch(/^\s+ports:/m);
  });

  it("copies the failure scenario into the lightweight smoke image", async () => {
    const dockerfile = await readFile(new URL("Dockerfile", root), "utf8");
    expect(dockerfile).toContain(
      "COPY --chown=node:node scripts/failure-scenario.mjs scripts/failure-scenario.mjs",
    );
  });
});
