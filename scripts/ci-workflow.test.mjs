/* global URL */

import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);

function unquote(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function workflowLines(source) {
  return source.split("\n").map((raw) => {
    const content = raw.replace(/\s+#.*$/, "").trimEnd();
    return { raw, content, indent: /^ */.exec(content)?.[0].length ?? 0 };
  }).filter(({ content }) => content.trim() !== "");
}

function entry(line) {
  const content = line.content.trimStart().replace(/^-\s+/, "");
  const match = /^(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+)):\s*(.*)$/.exec(content);
  if (!match) return null;
  return { key: match[1] ?? match[2] ?? match[3], value: unquote(match[4]) };
}

function valuesFor(lines, key) {
  return lines.flatMap((line) => {
    const parsed = entry(line);
    return parsed?.key === key ? [{ line, value: parsed.value }] : [];
  });
}

function onlyValue(lines, key, indent) {
  const matches = valuesFor(lines, key).filter(({ line }) => indent === undefined || line.indent === indent);
  expect(matches, `expected one ${key} entry`).toHaveLength(1);
  return matches[0].value;
}

function blockFor(lines, key, indent) {
  const start = lines.findIndex((line) => line.indent === indent && entry(line)?.key === key);
  expect(start, `missing ${key} block`).toBeGreaterThanOrEqual(0);
  const endOffset = lines.slice(start + 1).findIndex((line) => line.indent <= indent);
  return lines.slice(start + 1, endOffset === -1 ? undefined : start + 1 + endOffset);
}

function directKeys(lines, indent) {
  return lines.filter((line) => line.indent === indent).map((line) => entry(line)?.key).sort();
}

function stepBlocks(checkBlock) {
  const steps = blockFor(checkBlock, "steps", 4);
  const starts = steps.flatMap((line, index) => (
    line.indent === 6 && /^\s*-\s+/.test(line.content) ? [index] : []
  ));
  return starts.map((start, index) => steps.slice(start, starts[index + 1]));
}

describe("CI workflow contract", () => {
  let workflow;
  let lines;

  beforeAll(async () => {
    workflow = await readFile(new URL(".github/workflows/ci.yml", root), "utf8");
    lines = workflowLines(workflow);
  });

  it("uses exact triggers and repository-wide read-only permissions", () => {
    expect(onlyValue(lines, "name", 0)).toBe("CI");

    const triggers = blockFor(lines, "on", 0);
    expect(directKeys(triggers, 2)).toEqual(["pull_request", "push"]);
    expect(triggers.every((line) => line.indent === 2 && onlyValue(triggers, entry(line).key, 2) === ""))
      .toBe(true);

    const permissions = blockFor(lines, "permissions", 0);
    expect(directKeys(permissions, 2)).toEqual(["contents"]);
    expect(onlyValue(permissions, "contents", 2)).toBe("read");
    expect(lines.map(({ content }) => content).join("\n")).not.toMatch(/\b(?:write|write-all)\b/i);
  });

  it("has one check job on the required runner", () => {
    const jobs = blockFor(lines, "jobs", 0);
    expect(directKeys(jobs, 2)).toEqual(["check"]);

    const check = blockFor(jobs, "check", 2);
    expect(directKeys(check, 4)).toEqual(["runs-on", "steps"]);
    expect(onlyValue(check, "runs-on", 4)).toBe("ubuntu-latest");
  });

  it("pins only the approved actions to immutable SHAs with v5 version comments", () => {
    const check = blockFor(blockFor(lines, "jobs", 0), "check", 2);
    const actionSteps = stepBlocks(check).filter((step) => valuesFor(step, "uses").length > 0);
    const actions = actionSteps.map((step) => onlyValue(step, "uses"));

    expect(actions.map((action) => action.split("@")[0])).toEqual([
      "actions/checkout",
      "pnpm/action-setup",
      "actions/setup-node",
    ]);
    for (const step of actionSteps) {
      expect(onlyValue(step, "uses")).toMatch(/^[\w-]+\/[\w-]+@[0-9a-f]{40}$/);
      expect(valuesFor(step, "uses")[0].line.raw).toMatch(/#\s*v5\.\d+\.\d+\s*$/);
    }
  });

  it("uses the exact toolchain, cache, install, and check commands", () => {
    const check = blockFor(blockFor(lines, "jobs", 0), "check", 2);
    const steps = stepBlocks(check);
    const actionStep = (repository) => steps.find((step) => onlyValue(step, "uses").startsWith(`${repository}@`));

    expect(onlyValue(actionStep("pnpm/action-setup"), "version")).toBe("10.30.3");
    expect(onlyValue(actionStep("actions/setup-node"), "node-version")).toBe("24.18.0");
    expect(onlyValue(actionStep("actions/setup-node"), "cache")).toBe("pnpm");
    expect(steps.flatMap((step) => valuesFor(step, "run").map(({ value }) => value))).toEqual([
      "pnpm install --frozen-lockfile",
      "pnpm check",
    ]);
  });

  it("forbids service, matrix, Compose, deployment, and release expansion", () => {
    const content = lines.map((line) => line.content).join("\n");
    expect(content).not.toMatch(/\b(?:redis|services|matrix|deployment|release)\b|docker\s+compose/i);
  });
});
