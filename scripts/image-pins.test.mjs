/* global URL */

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);
const digestPattern = /@sha256:[0-9a-f]{64}(?:\s|$)/;

describe("container image pins", () => {
  it("pins every Dockerfile base image and reuses one verified Node digest", async () => {
    const dockerfile = await readFile(new URL("Dockerfile", root), "utf8");
    const fromLines = dockerfile.split("\n").filter((line) => line.startsWith("FROM "));
    const nodeLines = fromLines.filter((line) => line.includes("node:"));

    expect(nodeLines.length).toBeGreaterThan(0);
    expect(nodeLines.every((line) => digestPattern.test(line))).toBe(true);
    const nodeDigests = nodeLines.map((line) => /node:[^@\s]+(@sha256:[0-9a-f]{64})/.exec(line)?.[1]);
    expect(new Set(nodeDigests)).toEqual(new Set([
      "@sha256:5711a0d445a1af54af9589066c646df387d1831a608226f4cd694fc59e745059",
    ]));
  });

  it("pins every explicit Compose image to the inspected PostgreSQL digest", async () => {
    const compose = await readFile(new URL("compose.yaml", root), "utf8");
    const imageLines = compose.split("\n").filter((line) => /^\s+image:/.test(line));

    expect(imageLines).toEqual([
      "    image: postgres:17-bookworm@sha256:4f736ae292687621d4dbe0d499ffd024a36bd2ee7d8ca6f2ccd4c800f047b394",
    ]);
  });

  it("pins the Node wrapper to the same verified digest", async () => {
    const wrapper = await readFile(new URL("scripts/run-node24", root), "utf8");
    expect(wrapper).toContain(
      "node:24.18.0-bookworm@sha256:5711a0d445a1af54af9589066c646df387d1831a608226f4cd694fc59e745059",
    );
  });
});
