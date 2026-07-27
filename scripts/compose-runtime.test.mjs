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

  it("wires an isolated one-shot demo through the healthy internal API", async () => {
    const compose = await readFile(new URL("compose.yaml", root), "utf8");
    const demo = /\n {2}demo:\n([\s\S]*?)\n\nvolumes:/.exec(compose)?.[1];

    expect(demo).toBeDefined();
    expect(demo).toContain('profiles: ["demo"]');
    expect(demo).toContain("API_URL: http://api:3000");
    expect(demo).toContain("DASHBOARD_URL: http://127.0.0.1:3000");
    expect(demo).toContain('command: ["node", "scripts/demo.mjs"]');
    expect(demo).toContain("condition: service_healthy");
    expect(demo).not.toMatch(/^\s+volumes:/m);
    expect(demo).not.toMatch(/^\s+ports:/m);
  });

  it("copies the demo client into the lightweight smoke image", async () => {
    const dockerfile = await readFile(new URL("Dockerfile", root), "utf8");
    expect(dockerfile).toContain(
      "COPY --chown=node:node scripts/demo.mjs scripts/demo.mjs",
    );
  });
});
