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
const automatedTestCount = 540;

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
    expect(quickStart).toContain("scripts/run-node24 pnpm install --frozen-lockfile");
    expect(quickStart).toContain("docker compose up -d --build --wait postgres migrate api worker");
    expect([...quickStart.matchAll(/docker compose up [^\n]+/g)].map((match) => match[0])).toEqual([
      "docker compose up -d --build --wait postgres migrate api worker",
    ]);
  });

  it("runs the one-shot demo with the exact Compose command", () => {
    expect(section(readme, "Demo")).toContain("docker compose run --rm demo");
  });

  it("states the exact automated test count and runnable verification commands", () => {
    const verification = section(readme, "Verification");
    expect(verification).toContain(`${automatedTestCount} automated tests`);
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
