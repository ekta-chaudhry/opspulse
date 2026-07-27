# OpsPulse Resume-Ready Demo Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package the existing HTTP-monitoring vertical slice as a recruiter-ready repository and repeatable local demo without adding product features.

**Architecture:** Keep the current Express, PostgreSQL, worker, and static-dashboard runtime unchanged. Add only a thin demo client, repository presentation assets, and a minimal CI workflow; verify all claims against the existing contracts and Compose stack.

**Tech Stack:** Node.js 24, pnpm 10, Vitest, GitHub Actions, Docker Compose, Markdown, Mermaid

---

## File Map

- Create `scripts/demo.mjs`: bounded API-driven failure-to-incident demonstration.
- Create `scripts/demo.test.mjs`: tests demo result selection and safe output.
- Modify `Dockerfile`: includes the demo client in the existing lightweight smoke image.
- Modify `compose.yaml`: exposes the demo as an isolated one-shot profile service.
- Modify `scripts/compose-runtime.test.mjs`: verifies demo service isolation and wiring.
- Create `.github/workflows/ci.yml`: runs the existing repository check.
- Create `scripts/ci-workflow.test.mjs`: guards the workflow's runtime, permissions, and command.
- Modify `README.md`: recruiter-facing overview, architecture, quick start, demo, engineering highlights, and limitations.
- Create `docs/images/dashboard-overview.png`: full dashboard with monitor, check, and incident data.
- Create `docs/images/monitor-configuration.png`: HTTP monitor edit form.
- Create `docs/images/incident-history.png`: monitor detail with failed check and incident history.
- Create `scripts/readme.test.mjs`: verifies documentation structure, commands, links, images, and honest scope.

## Chunk 1: Repeatable Demo And CI

### Task 1: Add The Failure-To-Incident Demo

**Files:**
- Create: `scripts/demo.mjs`
- Create: `scripts/demo.test.mjs`
- Modify: `Dockerfile`
- Modify: `compose.yaml:68-85`
- Modify: `scripts/compose-runtime.test.mjs`
- Reference: `scripts/smoke-state.mjs`
- Reference: `scripts/smoke-vertical-slice.mjs`

- [ ] **Step 1: Write failing demo tests**

Export pure `findFailedCheck(monitorId, checks)` and `findOpenIncident(monitorId, incidents)` helpers from `scripts/demo.mjs`. Test that they return only a completed DNS/`ENOTFOUND` failure and exactly one open incident for the same monitor, return `null` while work is pending, and reject mismatched monitor data. Test bounded polling with injected loaders so check and incident timeouts produce distinct stable errors.

```js
it("selects the failed check for the created monitor", () => {
  expect(findFailedCheck(monitorId, checks)).toMatchObject({
    checkRequestId,
    cause: "dns/ENOTFOUND",
  });
});

it("does not print target configuration or raw errors", () => {
  expect(JSON.stringify(findFailedCheck(monitorId, checks)))
    .not.toMatch(/url|headers|raw/i);
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
scripts/run-node24 pnpm exec vitest run scripts/demo.test.mjs
```

Expected: FAIL because `scripts/demo.mjs` does not exist.

- [ ] **Step 3: Implement the minimal demo client**

Implement `scripts/demo.mjs` with:

- `API_URL`, defaulting to `http://api:3000` for Compose execution.
- `DASHBOARD_URL`, defaulting to the host-facing `http://127.0.0.1:3000` for printed output.
- A 60-second bounded liveness wait.
- Creation of `Resume demo <ISO timestamp>` targeting `http://does-not-exist.invalid/` with `failureThreshold: 1`.
- A bounded check-completion polling phase for `/v1/monitors/:id/checks?limit=10` with `DNS failure timed out` on failure.
- A separate bounded incident polling phase for `/v1/incidents?monitorId=:id&status=open&limit=10` with `Open incident timed out` on failure.
- Compact JSON output containing only `dashboardUrl`, `monitorId`, `checkRequestId`, `incidentId`, `result`, and `cause`.
- Stable phase-specific errors for liveness, monitor creation, DNS failure, and incident creation.
- A direct-execution guard so importing the helper does not run the demo.

Do not start Compose from JavaScript, bypass target security, persist additional state, or duplicate scheduler behavior.

- [ ] **Step 4: Add the one-shot Compose demo service**

Copy `scripts/demo.mjs` into the existing `smoke` image target. Add a `demo` service with profile `demo`, `API_URL: http://api:3000`, `DASHBOARD_URL: http://127.0.0.1:3000`, no volumes or published ports, API-health dependency, and command:

```yaml
command: ["node", "scripts/demo.mjs"]
```

Extend `scripts/compose-runtime.test.mjs` to assert the profile, internal API URL, host-facing dashboard URL, command, and absence of demo volumes.

- [ ] **Step 5: Run focused and full tests**

Run:

```bash
scripts/run-node24 pnpm exec vitest run scripts/demo.test.mjs scripts/compose-runtime.test.mjs
scripts/run-node24 pnpm check
```

Expected: focused tests pass and the complete check reports zero failures.

- [ ] **Step 6: Verify the demo against Compose**

Run:

```bash
docker compose up -d --build --wait postgres migrate api worker
docker compose run --rm demo
```

Expected: one compact JSON object with `result: "failure"`, `cause: "dns/ENOTFOUND"`, and valid monitor, check-request, and incident UUIDs.

- [ ] **Step 7: Commit**

```bash
git add Dockerfile compose.yaml scripts/demo.mjs scripts/demo.test.mjs scripts/compose-runtime.test.mjs
git commit -m "feat: add recruiter demo flow"
```

### Task 2: Add Minimal Continuous Integration

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `scripts/ci-workflow.test.mjs`

- [ ] **Step 1: Write a failing workflow contract test**

Read `.github/workflows/ci.yml` as text and assert it contains:

- Read-only repository permissions.
- Pull-request and push triggers.
- Ubuntu runner.
- Node `24.18.0`.
- pnpm `10.30.3`.
- Frozen-lockfile installation.
- `pnpm check`.

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
scripts/run-node24 pnpm exec vitest run scripts/ci-workflow.test.mjs
```

Expected: FAIL because `.github/workflows/ci.yml` does not exist.

- [ ] **Step 3: Create the workflow**

Create one `CI` workflow with `contents: read`, one `check` job, `actions/checkout`, `pnpm/action-setup`, `actions/setup-node` with pnpm caching, `pnpm install --frozen-lockfile`, and `pnpm check`. Do not add Redis, Compose, deployment, release, or matrix jobs.

- [ ] **Step 4: Verify locally**

Run:

```bash
scripts/run-node24 pnpm exec vitest run scripts/ci-workflow.test.mjs
scripts/run-node24 pnpm check
```

Expected: workflow contract and full repository check pass.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml scripts/ci-workflow.test.mjs
git commit -m "ci: verify OpsPulse changes"
```

## Chunk 2: Recruiter-Facing Presentation

### Task 3: Capture Honest Product Screenshots

**Files:**
- Create: `docs/images/dashboard-overview.png`
- Create: `docs/images/monitor-configuration.png`
- Create: `docs/images/incident-history.png`

- [ ] **Step 1: Seed the visible demo state**

Run:

```bash
docker compose up -d --build --wait postgres migrate api worker
docker compose run --rm demo
```

Open `http://127.0.0.1:3000` after the demo reports the incident.

- [ ] **Step 2: Capture the dashboard overview**

Capture the full desktop dashboard at approximately 1440 pixels wide. Ensure the monitor, failed recent check, and open incident are visible. Save as `docs/images/dashboard-overview.png`.

- [ ] **Step 3: Capture monitor configuration**

Open the demo monitor, select **Edit monitor**, and capture the populated form without exposing sensitive headers or local filesystem/browser chrome. Save as `docs/images/monitor-configuration.png`.

- [ ] **Step 4: Capture incident history**

Open monitor detail and capture its failed check and incident history. Save as `docs/images/incident-history.png`.

- [ ] **Step 5: Inspect image safety and readability**

Confirm each image:

- Contains no credentials, tokens, private headers, or unrelated desktop content.
- Is readable at GitHub's normal content width.
- Depicts the actual application rather than a mockup.

- [ ] **Step 6: Commit**

```bash
git add docs/images/dashboard-overview.png docs/images/monitor-configuration.png docs/images/incident-history.png
git commit -m "docs: add OpsPulse product screenshots"
```

- [ ] **Step 7: Stop the screenshot stack**

```bash
docker compose stop
```

Expected: API, worker, and PostgreSQL containers stop while named-volume data remains available.

### Task 4: Rewrite The README

**Files:**
- Modify: `README.md`
- Create: `scripts/readme.test.mjs`

- [ ] **Step 1: Write failing README checks**

Assert that the README contains these sections:

- `What OpsPulse Does`
- `Demo`
- `Architecture`
- `Reliability Engineering`
- `Quick Start`
- `Verification`
- `Current Scope`

Also assert that all three relative image files exist, the quick-start commands mention the exact Compose services, the demo uses `docker compose run --rm demo`, the verification section states the current automated test count, and the current-scope section explicitly says authentication, heartbeat monitoring, notifications, and public status pages are not implemented.

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
scripts/run-node24 pnpm exec vitest run scripts/readme.test.mjs
```

Expected: FAIL against the existing status-oriented README.

- [ ] **Step 3: Rewrite the README**

Keep it concise and use this order:

1. Project title, one-sentence value statement, and overview screenshot.
2. Implemented HTTP-monitoring capabilities.
3. Mermaid flow: browser dashboard to API/PostgreSQL, worker claim/check/evaluate, checks/incidents back to dashboard.
4. Reliability details: generation-safe edits, row-lock ordering, leases/reclamation, contiguous evaluation, SSRF defenses, archived history.
5. Quick start and demo commands.
6. Test and smoke verification.
7. Explicit current limitations.

Do not describe planned features as implemented or lead with roadmap language.

- [ ] **Step 4: Run documentation and full verification**

Run:

```bash
scripts/run-node24 pnpm exec vitest run scripts/readme.test.mjs
scripts/run-node24 pnpm check
git diff --check
```

Expected: all commands pass.

- [ ] **Step 5: Commit**

```bash
git add README.md scripts/readme.test.mjs
git commit -m "docs: present OpsPulse HTTP monitoring demo"
```

## Chunk 3: Final Acceptance

### Task 5: Verify From A Clean Worktree

**Files:**
- Verify only; no expected repository file changes.

- [ ] **Step 1: Create an isolated verification worktree**

From the feature worktree after all implementation commits, create a temporary detached worktree at the exact feature `HEAD` and ensure the destination does not already exist:

```bash
git worktree add --detach /tmp/opencode/opspulse-resume-verify "$(git rev-parse HEAD)"
```

- [ ] **Step 2: Verify frozen installation and checks**

Run from the temporary worktree:

```bash
scripts/run-node24 pnpm install --frozen-lockfile
scripts/run-node24 pnpm check
docker compose build
```

Expected: installation, all static checks/tests, and all images build successfully.

- [ ] **Step 3: Verify documented runtime commands**

Run:

```bash
docker compose --project-name opspulse-resume-verify up -d --wait postgres migrate api worker
docker compose --project-name opspulse-resume-verify run --rm demo
docker compose --project-name opspulse-resume-verify run --rm smoke
docker compose --project-name opspulse-resume-verify restart api worker
docker compose --project-name opspulse-resume-verify run --rm -e VERIFY_EXISTING=1 smoke
docker compose --project-name opspulse-resume-verify --profile demo --profile smoke down -v
```

Expected: services become healthy, the demo reports a DNS failure and incident, both fresh and restart smoke modes pass, and cleanup succeeds.

- [ ] **Step 4: Remove the temporary worktree**

Run from the main repository:

```bash
git worktree remove /tmp/opencode/opspulse-resume-verify
```

- [ ] **Step 5: Push and confirm GitHub CI**

Push the feature branch, open the workflow run, and confirm the `check` job succeeds. Do not add a branch badge before the workflow is on the repository's intended default branch.

- [ ] **Step 6: Final acceptance check**

Confirm:

- The repository landing page communicates value within five minutes.
- Screenshot links render on GitHub.
- CI is green.
- The demo is repeatable.
- Every claim is implemented today.
- The working branch is clean and synchronized with origin.
- The completion response provides the two approved resume bullets and 30-second interview wording without creating or modifying a resume file.
