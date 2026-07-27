/* global URL */

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);

describe("CI workflow contract", () => {
  it("runs the single read-only Node and pnpm repository check", async () => {
    const workflow = await readFile(new URL(".github/workflows/ci.yml", root), "utf8");

    expect(workflow).toBe(`name: CI

on:
  push:
  pull_request:

permissions:
  contents: read

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10.30.3
      - uses: actions/setup-node@v4
        with:
          node-version: 24.18.0
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm check
`);
  });
});
