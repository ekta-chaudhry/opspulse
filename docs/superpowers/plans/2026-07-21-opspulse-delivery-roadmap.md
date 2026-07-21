# OpsPulse Delivery Roadmap

This roadmap preserves the complete approved scope and defines implementation order. Each chunk receives a separate code-level implementation plan and review before execution.

**Goal:** Build and self-host the complete OpsPulse reliability platform defined in `docs/superpowers/specs/2026-07-21-opspulse-design.md`.

**Architecture:** A pnpm TypeScript monorepo separates the Express API, background worker roles, Next.js web app, and controllable demo service. PostgreSQL is the source of truth, Redis/BullMQ executes durable outbox work, and shared packages own contracts, domain state transitions, database access, and observability. Work proceeds in vertical phases, but every approved capability remains in the final plan.

**Tech Stack:** Node.js 24, TypeScript, pnpm workspaces, Express, Next.js, Zod/OpenAPI, PostgreSQL, Drizzle ORM, Redis, BullMQ, Vitest, Testcontainers, Playwright, OpenTelemetry, Prometheus, Grafana, Docker Compose, Caddy, Cloudflare Tunnel, GitHub Actions.

---

## File Map

- `apps/api/`: HTTP API, sessions, monitor management, heartbeat ingestion, public projections, admin CLIs
- `apps/worker/`: scheduler, checker, outbox dispatcher, notifier, reaper, and worker-heartbeat entry points
- `apps/web/`: authenticated operations dashboard and public status pages
- `apps/demo-service/`: deterministic healthy, slow, failing, and webhook-receiver behavior
- `packages/contracts/`: Zod schemas, OpenAPI registry, API types, webhook payloads
- `packages/domain/`: pure state machine, deterministic IDs, threshold and ordering rules
- `packages/database/`: Drizzle schema, SQL migrations, repositories, transactions, outbox
- `packages/observability/`: Pino logging, OpenTelemetry setup, metrics
- `tests/integration/`: PostgreSQL, Redis, queue, API, and worker integration tests
- `tests/e2e/`: browser and incident-lifecycle tests
- `tests/failure-drills/`: automated crash and recovery scenarios
- `deploy/compose/`: production Compose, Caddy, Cloudflare, telemetry, backup, and restore assets
- `.github/workflows/`: CI, image publication, protected deployment, backup verification

## Chunk 1: Repository And Domain Foundation

### Task 1: Scaffold The Monorepo

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `eslint.config.mjs`
- Create: `vitest.workspace.ts`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `README.md`
- Create: all `apps/*/package.json` and `packages/*/package.json`

- [ ] **Step 1: Add root workspace scripts**

Define `build`, `dev`, `lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, and `check` scripts. Pin Node `>=24 <25` and the current pnpm major through `packageManager`.

- [ ] **Step 2: Add strict shared TypeScript configuration**

Enable `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, NodeNext modules, source maps, and declaration output for packages.

- [ ] **Step 3: Add minimal package entry points**

Each app and package exports one placeholder module so workspace typechecking proves references resolve.

- [ ] **Step 4: Install dependencies and verify the empty workspace**

Run: `pnpm install && pnpm lint && pnpm typecheck && pnpm test`

Expected: all commands exit 0 with no tests collected outside placeholder smoke tests.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json eslint.config.mjs vitest.workspace.ts .gitignore .env.example README.md apps packages pnpm-lock.yaml
git commit -m "chore: scaffold OpsPulse monorepo"
```

### Task 2: Define Shared Contracts

**Files:**
- Create: `packages/contracts/src/monitor.ts`
- Create: `packages/contracts/src/session.ts`
- Create: `packages/contracts/src/incident.ts`
- Create: `packages/contracts/src/notification.ts`
- Create: `packages/contracts/src/errors.ts`
- Create: `packages/contracts/src/openapi.ts`
- Create: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/contracts.test.ts`

- [ ] **Step 1: Write failing schema tests**

Cover monitor names, HTTP methods, URL length, interval/grace/threshold ranges, unknown-field rejection, cursor limits, webhook payload version, and stable error shape.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @opspulse/contracts test`

Expected: FAIL because schemas are not implemented.

- [ ] **Step 3: Implement Zod schemas and exported types**

Use discriminated unions for HTTP and heartbeat monitors. Keep private configuration and public projections separate so private URLs and internal errors cannot leak by accidental serialization.

- [ ] **Step 4: Register schemas for OpenAPI**

Generate an OpenAPI document from the same runtime schemas rather than maintaining a handwritten duplicate.

- [ ] **Step 5: Verify**

Run: `pnpm --filter @opspulse/contracts test && pnpm --filter @opspulse/contracts typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts
git commit -m "feat: define OpsPulse API contracts"
```

### Task 3: Implement The Pure Monitor State Machine

**Files:**
- Create: `packages/domain/src/monitor-state.ts`
- Create: `packages/domain/src/identifiers.ts`
- Create: `packages/domain/src/webhook-payload.ts`
- Create: `packages/domain/src/index.ts`
- Test: `packages/domain/src/monitor-state.test.ts`
- Test: `packages/domain/src/identifiers.test.ts`

- [ ] **Step 1: Encode the transition table as failing parameterized tests**

Test every row from the approved design, including pending thresholds, degraded failures, down recovery, pause/resume, archive resolution, duplicate result no-op, and old-generation no-op.

- [ ] **Step 2: Add ordering tests**

Verify contiguous sequences, pending gaps, cancelled-internal advancement, counter resets, and one transition per result.

- [ ] **Step 3: Run tests and verify failure**

Run: `pnpm --filter @opspulse/domain test`

Expected: FAIL because `evaluateMonitorResult` does not exist.

- [ ] **Step 4: Implement a pure transition function**

```ts
export function evaluateMonitorResult(
  monitor: MonitorSnapshot,
  result: TerminalCheckResult,
): MonitorTransition {
  // Return the next snapshot plus explicit incident and outbox effects.
}
```

The function returns data effects; it performs no I/O and knows nothing about Express, PostgreSQL, or BullMQ.

- [ ] **Step 5: Implement deterministic identifiers**

Provide stable IDs for HTTP check requests, heartbeat deadlines, idempotent heartbeat pings, outbox events, notification deliveries, and replay deliveries.

- [ ] **Step 6: Verify**

Run: `pnpm --filter @opspulse/domain test && pnpm --filter @opspulse/domain typecheck`

Expected: PASS with every transition-table row covered.

- [ ] **Step 7: Commit**

```bash
git add packages/domain
git commit -m "feat: implement monitor state machine"
```

### Task 4: Create The PostgreSQL Schema And Migration Harness

**Files:**
- Create: `packages/database/src/schema/*.ts`
- Create: `packages/database/src/client.ts`
- Create: `packages/database/src/migrate.ts`
- Create: `packages/database/src/index.ts`
- Create: `packages/database/drizzle.config.ts`
- Create: `packages/database/migrations/0001_initial.sql`
- Test: `tests/integration/database-schema.test.ts`
- Create: `tests/integration/support/postgres.ts`

- [ ] **Step 1: Write failing Testcontainers schema tests**

Assert tables, foreign keys, unique check IDs, unique delivery deduplication keys, one-open-incident partial unique index, archived lifecycle fields, and outbox indexes.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm test:integration -- database-schema.test.ts`

Expected: FAIL because no migration exists.

- [ ] **Step 3: Implement the complete initial schema**

Create users, owner sessions, monitors, check requests, check runs, incidents, incident events, channels, monitor-channel assignments, deliveries, attempts, outbox events, worker heartbeats, and login-attempt records.

- [ ] **Step 4: Add migration and transaction helpers**

Expose explicit transaction boundaries and helpers for row locking, `SKIP LOCKED`, and advisory maintenance locks. Do not hide transactions behind generic repositories.

- [ ] **Step 5: Verify migration and rollback safety**

Run migrations twice against a fresh container and confirm the second run is a no-op. Verify the schema tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/database tests/integration
git commit -m "feat: add durable OpsPulse data model"
```

## Chunk 2: API, Authentication, And Monitor Lifecycle

### Task 5: Build The Express API Shell

**Files:**
- Create: `apps/api/src/app.ts`
- Create: `apps/api/src/server.ts`
- Create: `apps/api/src/config.ts`
- Create: `apps/api/src/middleware/error-handler.ts`
- Create: `apps/api/src/middleware/correlation-id.ts`
- Create: `apps/api/src/routes/health.ts`
- Test: `apps/api/src/app.test.ts`

- [ ] Write failing tests for correlation IDs, unknown routes, stable errors, liveness, database readiness, and graceful shutdown.
- [ ] Run `pnpm --filter @opspulse/api test` and verify failure.
- [ ] Implement app creation separately from process startup.
- [ ] Implement Zod-validated configuration with fail-fast secret checks.
- [ ] Add readiness checks that distinguish liveness from PostgreSQL and Redis dependency health.
- [ ] Verify API tests, typecheck, and an actual SIGTERM integration smoke test.
- [ ] Commit with `git commit -m "feat: add OpsPulse API foundation"`.

### Task 6: Implement Owner Bootstrap And Sessions

**Files:**
- Create: `apps/api/src/auth/password.ts`
- Create: `apps/api/src/auth/session-service.ts`
- Create: `apps/api/src/middleware/authenticate.ts`
- Create: `apps/api/src/middleware/csrf.ts`
- Create: `apps/api/src/routes/sessions.ts`
- Create: `apps/api/src/cli/owner-create.ts`
- Create: `apps/api/src/cli/owner-reset-password.ts`
- Test: `apps/api/src/auth/*.test.ts`
- Test: `tests/integration/auth.test.ts`

- [ ] Write failing tests for Argon2id hashes, one-owner constraint, generic login errors, five-attempt cooldown, opaque session hashing, idle/absolute expiry, CSRF rotation, logout, and password-reset revocation.
- [ ] Implement password and session primitives.
- [ ] Implement interactive owner CLI commands; never accept the password as a command-line argument.
- [ ] Implement secure cookie and in-memory CSRF-token API behavior.
- [ ] Verify unit and PostgreSQL integration tests.
- [ ] Commit with `git commit -m "feat: add single-owner authentication"`.

### Task 7: Implement Monitor And Channel Management

**Files:**
- Create: `apps/api/src/routes/monitors.ts`
- Create: `apps/api/src/routes/channels.ts`
- Create: `apps/api/src/services/monitor-service.ts`
- Create: `apps/api/src/services/channel-service.ts`
- Create: `apps/api/src/security/secrets.ts`
- Test: `tests/integration/monitor-api.test.ts`
- Test: `tests/integration/channel-api.test.ts`

- [ ] Write failing CRUD and authorization tests using the contracts from Task 2.
- [ ] Test schedule-generation increments for URL, method, headers, timeout, accepted status, interval, grace, pause, resume, and archive changes.
- [ ] Test heartbeat token one-time disclosure and immediate rotation invalidation.
- [ ] Test AES-256-GCM webhook secret storage, API redaction, archival, and immutable archived channels.
- [ ] Implement monitor and channel transactions, cursor pagination, filters, and archive semantics.
- [ ] Verify OpenAPI output matches implemented operations.
- [ ] Commit with `git commit -m "feat: add monitor and channel management"`.

## Chunk 3: Durable Work, HTTP Monitoring, And Incidents

### Task 8: Implement Transactional Outbox Dispatch

**Files:**
- Create: `packages/database/src/outbox.ts`
- Create: `apps/worker/src/queues.ts`
- Create: `apps/worker/src/outbox-dispatcher.ts`
- Create: `apps/worker/src/worker-heartbeat.ts`
- Test: `tests/integration/outbox.test.ts`

- [ ] Write failing tests for commit-before-dispatch, Redis outage retention, duplicate dispatch, crash-after-enqueue, and eventual outbox completion.
- [ ] Implement `SKIP LOCKED` outbox claiming and BullMQ event-ID job IDs.
- [ ] Mark dispatch only after BullMQ acceptance.
- [ ] Add dispatcher role heartbeats and graceful shutdown.
- [ ] Verify by stopping Redis during an integration test and confirming catch-up.
- [ ] Commit with `git commit -m "feat: add transactional outbox dispatch"`.

### Task 9: Implement PostgreSQL Scheduling And Reconciliation

**Files:**
- Create: `apps/worker/src/scheduler.ts`
- Create: `packages/database/src/scheduling.ts`
- Test: `tests/integration/scheduler.test.ts`

- [ ] Write failing tests for creation, interval changes, pause, resume, archive, generation changes, single in-flight HTTP request, missed scheduler time, and multiple scheduler instances.
- [ ] Implement deterministic requests, monotonic generation-scoped sequences, and `SKIP LOCKED` due claiming.
- [ ] Implement old-generation cancellation and fresh scheduling.
- [ ] Add scheduler role heartbeat and readiness.
- [ ] Verify two scheduler instances never create duplicate requests.
- [ ] Commit with `git commit -m "feat: add durable monitor scheduler"`.

### Task 10: Build The Safe Outbound HTTP Client

**Files:**
- Create: `apps/worker/src/http/safe-client.ts`
- Create: `apps/worker/src/http/address-policy.ts`
- Test: `apps/worker/src/http/safe-client.test.ts`

- [ ] Write tests for IPv4, IPv6, private, loopback, link-local, multicast, metadata, URL credentials, DNS rebinding, redirects, proxy variables, SNI, response cap, and timeout.
- [ ] Implement explicit DNS resolution, validation, address pinning, Host preservation, and TLS SNI verification.
- [ ] Permit public HTTP/HTTPS only and `GET`/`HEAD` methods.
- [ ] Verify against local controlled DNS and HTTP fixtures without allowing arbitrary network tests.
- [ ] Commit with `git commit -m "feat: secure outbound monitoring requests"`.

### Task 11: Implement HTTP Checking And Ordered Evaluation

**Files:**
- Create: `apps/worker/src/checker.ts`
- Create: `packages/database/src/evaluate-monitor.ts`
- Create: `apps/worker/src/request-reaper.ts`
- Test: `tests/integration/http-monitoring.test.ts`

- [ ] Write failing tests for success, unacceptable status, timeout, DNS failure, connection refusal, duplicate jobs, stale generations, cancelled requests, thresholds, incidents, and recovery.
- [ ] Implement one-transaction request completion, immutable result insertion, contiguous evaluation, incident timeline, notification delivery, and outbox creation.
- [ ] Implement six bounded internal attempts and the pending-request reaper.
- [ ] Add checker role heartbeat and graceful shutdown.
- [ ] Verify one incident and one recovery under duplicate and reordered work.
- [ ] Commit with `git commit -m "feat: add reliable HTTP monitoring"`.

### Task 12: Expose Incident And Check APIs

**Files:**
- Create: `apps/api/src/routes/incidents.ts`
- Create: `apps/api/src/routes/checks.ts`
- Create: `apps/api/src/routes/dashboard.ts`
- Test: `tests/integration/incident-api.test.ts`

- [ ] Write failing tests for cursor pagination, filters, active incident, timeline ordering, safe errors, monitor history, and dashboard totals.
- [ ] Implement read models and stable API responses.
- [ ] Verify private target URLs and internal errors never appear in public projections.
- [ ] Commit with `git commit -m "feat: expose monitoring history and incidents"`.

## Chunk 4: Heartbeats And Webhook Notifications

### Task 13: Implement Heartbeat Ingestion And Deadline Evaluation

**Files:**
- Create: `apps/api/src/routes/heartbeats.ts`
- Create: `packages/database/src/heartbeat.ts`
- Test: `tests/integration/heartbeat.test.ts`

- [ ] Write failing tests for valid token, invalid token, rate limiting, one-time token rotation, idempotency keys, missing keys, timely pings, late pings, multiple elapsed deadlines, 100-deadline cap, threshold incidents, and recovery.
- [ ] Implement ping and sweep operations using the same monitor-row lock and synchronous deadline materialization.
- [ ] Ensure elapsed failures evaluate before late recovery.
- [ ] Verify concurrent ping and sweep tests cannot produce a false incident or erase genuine lateness.
- [ ] Commit with `git commit -m "feat: add idempotent heartbeat monitoring"`.

### Task 14: Implement Signed Webhook Delivery

**Files:**
- Create: `apps/worker/src/notifier.ts`
- Create: `packages/domain/src/webhook-signature.ts`
- Create: `apps/api/src/routes/deliveries.ts`
- Create: `apps/api/src/routes/channel-tests.ts`
- Test: `tests/integration/webhook-delivery.test.ts`

- [ ] Write failing tests for payload v1, HMAC headers, event IDs, 2xx success, final 4xx, retryable statuses, timeout, no redirects, response cap, six attempts, immutable attempt rows, dead-letter visibility, and explicit replay keys.
- [ ] Reuse the safe outbound client for webhook SSRF protection.
- [ ] Implement notifier role heartbeat, retries with jitter, and manual final-failure replay.
- [ ] Verify incident state remains committed when every notification attempt fails.
- [ ] Commit with `git commit -m "feat: add signed retryable webhooks"`.

## Chunk 5: Private Dashboard And Public Status

### Task 15: Scaffold The Next.js Web Application

**Files:**
- Create: `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/app/login/page.tsx`
- Create: `apps/web/src/lib/api-client.ts`
- Create: `apps/web/src/styles/globals.css`
- Test: `apps/web/src/**/*.test.tsx`

- [ ] Write failing tests for login, session restoration, CSRF rotation, API errors, and logout.
- [ ] Implement a typed API client using contract types without importing server internals.
- [ ] Establish a distinctive operations-console visual system that works on mobile and desktop.
- [ ] Verify accessibility basics: labels, keyboard focus, contrast, and error announcements.
- [ ] Commit with `git commit -m "feat: add OpsPulse web foundation"`.

### Task 16: Build The Private Operations Dashboard

**Files:**
- Create: `apps/web/src/app/(private)/page.tsx`
- Create: `apps/web/src/app/(private)/monitors/**/*`
- Create: `apps/web/src/app/(private)/incidents/**/*`
- Create: `apps/web/src/app/(private)/channels/**/*`
- Create: `apps/web/src/components/**/*`
- Test: `apps/web/src/app/(private)/**/*.test.tsx`

- [ ] Write component and route tests for overview, worker freshness, monitor forms, check history, latency, incident timeline, channel tests, failed delivery replay, pause/resume, and archive confirmations.
- [ ] Implement responsive pages backed only by API contracts.
- [ ] Make stale monitoring roles visually impossible to confuse with healthy targets.
- [ ] Verify loading, empty, partial-failure, and error states.
- [ ] Commit with `git commit -m "feat: build operations dashboard"`.

### Task 17: Build The Public Status Page

**Files:**
- Create: `apps/api/src/routes/public-status.ts`
- Create: `apps/web/src/app/status/page.tsx`
- Create: `apps/web/src/app/status/[monitorId]/page.tsx`
- Test: `tests/integration/public-status.test.ts`
- Test: `apps/web/src/app/status/**/*.test.tsx`

- [ ] Write tests for public projections, worst-state aggregate, unknown pending, maintenance exclusion, archived removal, 90-day incidents, and scheduler/checker stale override.
- [ ] Implement API projection and cache-safe page rendering.
- [ ] Verify no target URL, token, raw error, owner data, or internal identifier leaks.
- [ ] Commit with `git commit -m "feat: add public service status pages"`.

## Chunk 6: Demonstration, Observability, And Operations

### Task 18: Create The Controllable Demo Service

**Files:**
- Create: `apps/demo-service/src/server.ts`
- Create: `apps/demo-service/src/state.ts`
- Test: `apps/demo-service/src/server.test.ts`

- [ ] Write tests for healthy, slow, failing, recovering, retryable webhook, final webhook, and captured signed-header modes.
- [ ] Implement authenticated local-only control endpoints and public monitored endpoints.
- [ ] Add a repeatable demo script that drives one complete incident and recovery.
- [ ] Commit with `git commit -m "feat: add reliability demo service"`.

### Task 19: Add OpenTelemetry And Metrics

**Files:**
- Create: `packages/observability/src/logging.ts`
- Create: `packages/observability/src/tracing.ts`
- Create: `packages/observability/src/metrics.ts`
- Create: `deploy/compose/otel-collector.yaml`
- Create: `deploy/compose/prometheus.yml`
- Create: `deploy/compose/grafana/provisioning/**/*`
- Create: `deploy/compose/grafana/dashboards/opspulse.json`
- Test: `tests/integration/telemetry.test.ts`

- [ ] Write tests for correlation IDs, secret redaction, HTTP-to-BullMQ trace propagation, metric names, bounded labels, and worker heartbeat age.
- [ ] Instrument API, database, Redis, scheduler, checker, evaluator, and notifier operations.
- [ ] Add Prometheus scrape and a provisioned Grafana dashboard.
- [ ] Verify a demo incident is traceable from check request through notification delivery.
- [ ] Commit with `git commit -m "feat: add OpsPulse observability"`.

### Task 20: Containerize The Full Stack

**Files:**
- Create: `apps/*/Dockerfile`
- Create: `.dockerignore`
- Create: `compose.yaml`
- Create: `compose.observability.yaml`
- Create: `deploy/compose/Caddyfile`
- Create: `deploy/compose/cloudflared.yaml`
- Test: `tests/e2e/compose-smoke.test.ts`

- [ ] Write a failing Compose smoke test for migration, owner bootstrap, health, monitor creation, incident, public status, and cleanup.
- [ ] Add multi-stage non-root images with health checks and graceful shutdown.
- [ ] Add private networks, named volumes, dependency readiness, migration job, Caddy, and optional Cloudflare profile.
- [ ] Verify the full stack runs within the documented 2 CPU, 4 GiB, 10 GiB target.
- [ ] Commit with `git commit -m "feat: add self-hosted Compose deployment"`.

### Task 21: Add Backups, Restore, And Upgrade Scripts

**Files:**
- Create: `deploy/compose/scripts/backup.sh`
- Create: `deploy/compose/scripts/restore-verify.sh`
- Create: `deploy/compose/scripts/deploy.sh`
- Create: `docs/operations/backup-and-restore.md`
- Create: `docs/operations/upgrades-and-rollback.md`
- Test: `tests/failure-drills/backup-restore.test.ts`

- [ ] Write a failing restore test that seeds owner, monitor, incident, and timeline data.
- [ ] Implement encrypted daily backup, retention, optional S3-compatible copy, and temporary-database restore verification.
- [ ] Implement image pinning, pre-deploy backup, migration, health gate, and application rollback.
- [ ] Verify restore acceptance checks from the design.
- [ ] Commit with `git commit -m "feat: add verified backup and restore"`.

### Task 22: Add CI, Image Publication, And Protected Deployment

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/images.yml`
- Create: `.github/workflows/deploy.yml`
- Create: `.github/dependabot.yml`

- [ ] Add CI jobs for lint, typecheck, unit, integration, e2e, migration, image build, and dependency/container scanning.
- [ ] Publish immutable commit-SHA images and release tags to GHCR.
- [ ] Add a protected manual deploy workflow that selects explicit tags and invokes the deployment script.
- [ ] Test workflows with local action validation and one GitHub run before enabling deployment secrets.
- [ ] Commit with `git commit -m "ci: add build and deployment pipelines"`.

### Task 23: Automate Failure Drills

**Files:**
- Create: `tests/failure-drills/*.test.ts`
- Create: `docs/operations/failure-drills.md`
- Create: `scripts/run-failure-drills.sh`

- [ ] Implement each failure-drill test and assertion from the approved design.
- [ ] Verify API restart, worker restart, Redis interruption, PostgreSQL interruption, webhook retries, duplicate jobs, stale results, and recovery.
- [ ] Capture expected telemetry and database evidence.
- [ ] Run the complete drill suite twice to prove cleanup and repeatability.
- [ ] Commit with `git commit -m "test: add production failure drills"`.

### Task 24: Finish Portfolio Documentation

**Files:**
- Modify: `README.md`
- Create: `docs/architecture.md`
- Create: `docs/api-examples.md`
- Create: `docs/self-hosting.md`
- Create: `docs/demo-script.md`
- Create: `docs/resume-entry.md`
- Create: `docs/images/*`

- [ ] Document product value, architecture, invariants, setup, self-hosting, security boundary, limitations, and operations.
- [ ] Add verified commands for HTTP monitor and heartbeat integrations.
- [ ] Capture dashboard, incident, status-page, tracing, and failure-drill screenshots.
- [ ] Add a concise live demo script and truthful resume bullets.
- [ ] Run every README command from a fresh clone.
- [ ] Run `pnpm check`, integration tests, e2e tests, failure drills, Compose smoke, backup restore, and image scans.
- [ ] Commit with `git commit -m "docs: complete OpsPulse portfolio presentation"`.

## Final Verification

Run from a fresh clone:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm test:integration
pnpm test:e2e
pnpm test:failure-drills
docker compose build
docker compose up -d
pnpm smoke:compose
pnpm backup:verify
docker compose down -v
```

Expected:

- All static checks and tests pass.
- HTTP and heartbeat monitors open and resolve exactly one incident under duplicate and reordered work.
- Webhook delivery signs payloads, retries safely, records attempts, and supports explicit failed-delivery replay.
- Private and public pages expose only their approved data.
- Redis and PostgreSQL recovery drills preserve committed work and restore processing.
- Telemetry connects API, queue, worker, incident, and notification activity.
- The self-hosted stack starts from documented configuration and restores a verified backup.
