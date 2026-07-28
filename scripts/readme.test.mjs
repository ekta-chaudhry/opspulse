/* global URL */

import { access, readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);
const expectedSections = [
  "What OpsPulse Does",
  "Architecture",
  "Reliability Engineering",
  "Quick Start",
  "Demo",
  "Verification",
  "Current Scope",
];
const images = [
  "docs/images/dashboard-overview.png",
  "docs/images/monitor-configuration.png",
  "docs/images/incident-history.png",
];
function section(readme, heading) {
  const marker = `## ${heading}\n`;
  const start = readme.indexOf(marker);
  expect(start, `missing ${heading} section`).toBeGreaterThanOrEqual(0);
  const contentStart = start + marker.length;
  const nextSection = readme.indexOf("\n## ", contentStart);
  return readme.slice(contentStart, nextSection === -1 ? undefined : nextSection);
}

describe("README contract", () => {
  let readme;

  beforeAll(async () => {
    readme = await readFile(new URL("README.md", root), "utf8");
  });

  it("presents the required sections in recruiter reading order", () => {
    expect([...readme.matchAll(/^## (.+)$/gm)].map((match) => match[1])).toEqual(expectedSections);
  });

  it("references all three repository screenshots by their actual relative paths", async () => {
    await Promise.all(images.map((image) => access(new URL(image, root))));
    for (const image of images) {
      expect(readme).toMatch(new RegExp(`!\\[[^\\]]+\\]\\(${image.replaceAll(".", "\\.")}\\)`));
    }
  });

  it("documents the exact host setup and Compose startup commands", () => {
    const quickStart = section(readme, "Quick Start");
    expect(quickStart).toContain("The only host prerequisite is Docker Engine with Docker Compose.");
    expect(quickStart).toContain("Node.js 24.18.x and pnpm 10.30.3");
    expect(quickStart).toMatch(/scripts\/run-node24[^.]+supplies both in a container\./);
    expect(quickStart).not.toMatch(/Prerequisites are Node\.js|install Node\.js|install pnpm/i);
    expect(quickStart).not.toMatch(/^curl /m);
    expect(quickStart).toContain("scripts/run-node24 pnpm install --frozen-lockfile");
    expect(quickStart).toContain("docker compose up -d --build --wait postgres migrate api worker");
    expect([...quickStart.matchAll(/docker compose up [^\n]+/g)].map((match) => match[0])).toEqual([
      "docker compose up -d --build --wait postgres migrate api worker",
    ]);
  });

  it("models monitor, check, and incident tables inside PostgreSQL", () => {
    const architecture = section(readme, "Architecture");
    const diagram = /```mermaid\n([\s\S]*?)```/.exec(architecture)?.[1];
    expect(diagram, "missing Mermaid architecture diagram").toBeDefined();
    expect(diagram).toContain("subgraph P[PostgreSQL]");
    expect(diagram).toContain("M[(monitors)]");
    expect(diagram).toContain("C[(check requests and runs)]");
    expect(diagram).toContain("I[(incidents and events)]");
    expect(diagram).toContain("A -->|Query and mutate| M");
    expect(diagram).toContain("A -->|Query| C");
    expect(diagram).toContain("A -->|Query| I");
    expect(diagram).toMatch(/W -->\|Claim and persist checks\| C/);
    expect(diagram).toMatch(/W -->\|Evaluate incident state\| I/);
    expect(diagram).not.toContain("H[Checks and incidents]");
  });

  it("runs the one-shot demo with the exact Compose command", () => {
    expect(section(readme, "Demo")).toContain("docker compose run --rm demo");
  });

  it("states a durable automated test floor and runnable verification commands", () => {
    const verification = section(readme, "Verification");
    expect(verification).toContain("500+ automated tests");
    expect(verification).not.toMatch(/\b\d+ automated tests\b/);
    expect(verification).toContain("scripts/run-node24 pnpm test:unit");
    expect(verification).toContain("scripts/run-node24 pnpm check");
    expect(verification).toContain("docker compose run --rm smoke");
    expect(verification).toContain("docker compose restart api worker");
    expect(verification).toContain("docker compose run --rm -e VERIFY_EXISTING=1 smoke");
  });

  it("states the unimplemented scope explicitly without roadmap framing", () => {
    const currentScope = section(readme, "Current Scope");
    expect(currentScope).toMatch(
      /authentication, heartbeat monitoring, notifications, and public status pages are not implemented\./i,
    );
    expect(readme).not.toMatch(/^## (?:Status|Planned Product|Roadmap)$/m);
    expect(readme).not.toMatch(/\[!\[[^\]]*(?:CI|build)[^\]]*\]/i);
  });
});
