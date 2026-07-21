# OpsPulse Phase 1 Foundation Roadmap

This roadmap preserves the complete Phase 1 scope. Each task receives a separate executable plan and review before implementation.

**Goal:** Establish the typed contracts, pure reliability domain, and durable PostgreSQL schema that every OpsPulse vertical feature will use.

**Architecture:** Phase 1 creates only reusable packages and integration-test infrastructure. `packages/contracts` owns runtime/API shapes, `packages/domain` owns deterministic pure behavior, and `packages/database` owns PostgreSQL persistence and transaction primitives. No HTTP app or worker process is introduced until these boundaries are executable and tested.

**Tech Stack:** Node.js 24 compatibility, TypeScript 6.0.3, pnpm 10.30.3, ESLint 10, Vitest 4, Zod 4, Zod OpenAPI 9, Drizzle ORM 0.45, PostgreSQL 17, Testcontainers 12.

---

## Exact File Structure

```text
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
tsconfig.base.json
eslint.config.mjs
vitest.config.ts
vitest.integration.config.ts
.gitignore
.env.example
README.md
packages/
  contracts/
    package.json
    tsconfig.json
    src/
      common.ts
      errors.ts
      sessions.ts
      monitors.ts
      checks.ts
      incidents.ts
      notifications.ts
      dashboard.ts
      public-status.ts
      openapi.ts
      index.ts
      *.test.ts
  domain/
    package.json
    tsconfig.json
    src/
      monitor-state.ts
      monitor-state.test.ts
      identifiers.ts
      identifiers.test.ts
      webhook-payload.ts
      webhook-payload.test.ts
      index.ts
  database/
    package.json
    tsconfig.json
    drizzle.config.ts
    src/
      client.ts
      migrate.ts
      transaction.ts
      schema/
        auth.ts
        monitors.ts
        checks.ts
        incidents.ts
        notifications.ts
        outbox.ts
        workers.ts
        index.ts
      index.ts
    migrations/
      0001_initial.sql
tests/
  integration/
    support/postgres.ts
    database-schema.test.ts
```

## Task 1: Reproducible Workspace

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `eslint.config.mjs`
- Create: `vitest.config.ts`
- Create: `vitest.integration.config.ts`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `README.md`
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/domain/package.json`
- Create: `packages/domain/tsconfig.json`
- Create: `packages/database/package.json`
- Create: `packages/database/tsconfig.json`

- [ ] **Step 1: Create the root package manifest**

Use this exact initial shape:

```json
{
  "name": "opspulse",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.30.3",
  "engines": { "node": ">=24 <26" },
  "scripts": {
    "build": "pnpm -r --if-present build",
    "lint": "eslint .",
    "typecheck": "pnpm -r --if-present typecheck",
    "test": "vitest run",
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "check": "pnpm lint && pnpm typecheck && pnpm test"
  },
  "devDependencies": {
    "@eslint/js": "10.0.1",
    "@types/node": "24.13.3",
    "eslint": "10.7.0",
    "typescript": "6.0.3",
    "typescript-eslint": "8.65.0",
    "vitest": "4.1.10"
  }
}
```

- [ ] **Step 2: Declare workspace packages**

`pnpm-workspace.yaml`:

```yaml
packages:
  - packages/*
  - apps/*
```

- [ ] **Step 3: Add strict shared TypeScript settings**

`tsconfig.base.json` must set `target: ES2023`, `module` and `moduleResolution: NodeNext`, `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `isolatedModules`, `declaration`, `declarationMap`, `sourceMap`, and `skipLibCheck: false`.

- [ ] **Step 4: Add ESLint configuration**

Use `@eslint/js` recommended plus `typescript-eslint` strict type-checked rules. Ignore `dist`, `coverage`, `.next`, and generated migration metadata. Disable formatting-only rules; ESLint is for semantic and correctness checks.

- [ ] **Step 5: Add Vitest configurations**

`vitest.config.ts` includes `packages/**/*.test.ts` and excludes `tests/integration/**`. `vitest.integration.config.ts` includes only `tests/integration/**/*.test.ts`, uses the Node environment, disables file parallelism for database schema tests, and sets a 60-second test timeout.

- [ ] **Step 6: Add exact package manifests**

`@opspulse/contracts` dependencies:

```json
{
  "@asteasolutions/zod-to-openapi": "9.1.0",
  "zod": "4.4.3"
}
```

`@opspulse/domain` depends on `@opspulse/contracts: workspace:*`.

`@opspulse/database` dependencies:

```json
{
  "@opspulse/contracts": "workspace:*",
  "@opspulse/domain": "workspace:*",
  "drizzle-orm": "0.45.2",
  "pg": "8.22.0"
}
```

Database development dependencies include `drizzle-kit: 0.31.10`, `@types/pg: 8.20.0`, `testcontainers: 12.0.4`, and `@testcontainers/postgresql: 12.0.4`.

Each package exports `./dist/index.js`, types from `./dist/index.d.ts`, and defines exact `build`, `typecheck`, and `test` scripts using `tsc` and Vitest.

- [ ] **Step 7: Add environment and ignore files**

Ignore dependencies, build output, coverage, local environment files, IDE files, and PostgreSQL test artifacts. `.env.example` contains only `DATABASE_URL=postgresql://opspulse:opspulse@localhost:5432/opspulse` in Phase 1.

- [ ] **Step 8: Add an initial README**

State the product goal, link the approved design and delivery roadmap, list prerequisites, and mark implementation status as Phase 1 foundation. Do not claim unimplemented features.

- [ ] **Step 9: Install locked dependencies**

Run: `pnpm install`

Expected: `pnpm-lock.yaml` is created and installation exits 0.

- [ ] **Step 10: Verify workspace configuration**

Run: `pnpm lint && pnpm typecheck`

Expected: exit 0; package typechecks may report no input until source files are added, but must not report unresolved configuration or dependency errors.

- [ ] **Step 11: Commit**

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json eslint.config.mjs vitest.config.ts vitest.integration.config.ts .gitignore .env.example README.md packages
git commit -m "chore: scaffold OpsPulse workspace"
```

## Task 2: Complete Runtime And API Contracts

**Files:**
- Create: `packages/contracts/src/common.ts`
- Create: `packages/contracts/src/errors.ts`
- Create: `packages/contracts/src/sessions.ts`
- Create: `packages/contracts/src/monitors.ts`
- Create: `packages/contracts/src/checks.ts`
- Create: `packages/contracts/src/incidents.ts`
- Create: `packages/contracts/src/notifications.ts`
- Create: `packages/contracts/src/dashboard.ts`
- Create: `packages/contracts/src/public-status.ts`
- Create: `packages/contracts/src/openapi.ts`
- Create: `packages/contracts/src/index.ts`
- Test: one adjacent `.test.ts` file for each source module

- [ ] **Step 1: Write common-schema tests**

Test opaque UUIDs, ISO timestamps, cursor pagination default 25 and max 100, strict-object unknown-field rejection, correlation IDs, and non-empty safe messages.

- [ ] **Step 2: Run common tests and verify failure**

Run: `pnpm --filter @opspulse/contracts test -- common.test.ts`

Expected: FAIL because `common.ts` does not exist.

- [ ] **Step 3: Implement common schemas**

Export `IdSchema`, `TimestampSchema`, `CursorQuerySchema`, `CursorPageSchema`, and reusable strict-object helpers. API IDs remain internal; public monitors use a separate `PublicMonitorSlugSchema`.

- [ ] **Step 4: Write and implement error contracts**

Test and implement:

```ts
type ApiError = {
  error: {
    code: string;
    message: string;
    correlationId: string;
    details?: unknown;
  };
};
```

Cover the design's 400, 401, 403, 404, 409, and 429 error codes.

- [ ] **Step 5: Write and implement session contracts**

Cover login, current session, logout, CSRF rotation, owner-safe session metadata, and generic authentication failure. Passwords are accepted only on login schemas and never appear in response types.

- [ ] **Step 6: Write monitor contract tests**

Cover HTTP and heartbeat discriminated unions, name 1-100 characters, URL max 2,048, GET/HEAD only, interval 30 seconds-24 hours, grace 0-24 hours, thresholds 1-10, timeout 1-30 seconds, status 100-599 with minimum not above maximum, lifecycle/state enums, public slug, pause/resume/archive, token rotation response, and monitor-channel assignment.

- [ ] **Step 7: Run monitor tests and verify failure**

Run: `pnpm --filter @opspulse/contracts test -- monitors.test.ts`

Expected: FAIL because monitor schemas are absent.

- [ ] **Step 8: Implement monitor contracts**

Separate `PrivateMonitorSchema`, `PublicMonitorSchema`, `CreateMonitorSchema`, `UpdateMonitorSchema`, lifecycle command responses, and one-time `HeartbeatTokenResponseSchema`. Private target URLs and headers have no representation in public contracts.

- [ ] **Step 9: Write and implement check and incident contracts**

Checks cover request source/status, result classification, latency/status, safe errors, generation, sequence, scheduled/completed/evaluated times, cursor filters, and immutable history. Incidents cover open/resolved state, cause, timeline event enum, stable newest-first list, monitor/time filters, and active incident summaries.

- [ ] **Step 10: Write and implement notification contracts**

Cover channel create/update/archive/test, redacted channel responses, monitor assignments, delivery states, immutable attempt history, final-failure replay confirmation, and `opspulse.webhook.v1` payload and headers.

- [ ] **Step 11: Write and implement dashboard and public-status contracts**

Dashboard schemas include all scheduler/checker/dispatcher/notifier role freshness, counts, latency summary, active incidents, and notification failures. Public schemas cover unknown/operational/degraded/outage/maintenance, published monitors only, worst-state aggregate, monitoring-unavailable override, last-updated time, and 90-day incidents.

- [ ] **Step 12: Register OpenAPI operations**

Register every route category from the design with request, success, and error schemas. Generate a deterministic JSON document with title `OpsPulse API`, version `1.0.0`, and `/v1` paths.

- [ ] **Step 13: Add an OpenAPI snapshot test**

Assert all approved operations exist, every operation has at least one error response, heartbeat is token-authenticated rather than session-authenticated, and private schemas are absent from public-status responses.

- [ ] **Step 14: Verify contracts**

Run: `pnpm --filter @opspulse/contracts test && pnpm --filter @opspulse/contracts typecheck && pnpm --filter @opspulse/contracts build`

Expected: all tests pass and `dist/index.js` plus declarations are generated.

- [ ] **Step 15: Run workspace regression**

Run: `pnpm lint && pnpm typecheck && pnpm test`

Expected: exit 0.

- [ ] **Step 16: Commit**

```bash
git add packages/contracts pnpm-lock.yaml
git commit -m "feat: define OpsPulse contracts"
```

## Task 3: Pure Reliability Domain

**Files:**
- Create: `packages/domain/src/monitor-state.ts`
- Create: `packages/domain/src/monitor-state.test.ts`
- Create: `packages/domain/src/identifiers.ts`
- Create: `packages/domain/src/identifiers.test.ts`
- Create: `packages/domain/src/webhook-payload.ts`
- Create: `packages/domain/src/webhook-payload.test.ts`
- Create: `packages/domain/src/index.ts`

- [ ] **Step 1: Define the state-machine test fixtures**

Create explicit `MonitorSnapshot`, `TerminalCheck`, and expected `MonitorTransition` builders in the test file. Fixtures include lifecycle, generation, last and next sequence, counters, state, active incident ID, and materially changed cause.

- [ ] **Step 2: Write every transition-table test**

Use `it.each` for all 12 approved rows. Assert next state, counters, incident effect (`none`, `open`, `observe`, `resolve`), and outbox intent.

- [ ] **Step 3: Write ordering and lifecycle tests**

Cover duplicate ID, old generation, lower sequence, sequence gap, contiguous next sequence, cancelled-internal advancement, pause, resume reset, archive with open incident, and archive without incident.

- [ ] **Step 4: Run state tests and verify failure**

Run: `pnpm --filter @opspulse/domain test -- monitor-state.test.ts`

Expected: FAIL because the state evaluator is absent.

- [ ] **Step 5: Implement explicit domain interfaces**

```ts
export type MonitorEffect =
  | { type: "incident.open"; cause: FailureCause }
  | { type: "incident.observe"; cause: FailureCause }
  | { type: "incident.resolve"; reason: "recovered" | "monitor_archived" }
  | { type: "result.ignore"; reason: "duplicate" | "stale_generation" | "stale_sequence" | "sequence_gap" };

export type MonitorTransition = {
  snapshot: MonitorSnapshot;
  effects: readonly MonitorEffect[];
};
```

Keep persistence and notification-delivery details outside this package; effects state what the transaction layer must persist.

- [ ] **Step 6: Implement `evaluateMonitorResult`**

Process only the expected contiguous sequence in the active generation. Implement threshold counters and materially changed failure observation exactly as the design table states.

- [ ] **Step 7: Implement lifecycle transitions**

Add pure `pauseMonitor`, `resumeMonitor`, and `archiveMonitor` functions. Resume resets state/counters and increments generation. Archive emits resolution when an incident is open.

- [ ] **Step 8: Verify state tests**

Run: `pnpm --filter @opspulse/domain test -- monitor-state.test.ts`

Expected: PASS with every state and lifecycle branch covered.

- [ ] **Step 9: Write deterministic-ID tests**

Cover equal inputs producing equal IDs, distinct generations/deadlines/keys producing distinct IDs, stable output format, and replay keys appending a monotonic replay number.

- [ ] **Step 10: Implement deterministic IDs**

Export functions for HTTP request, missed-heartbeat request, heartbeat idempotency key, outbox event, notification delivery, and replay delivery IDs using SHA-256 over versioned, length-delimited inputs.

- [ ] **Step 11: Write webhook payload tests**

Assert the exact `opspulse.webhook.v1` fields, safe monitor identity, no target URL or private error, stable event ID, open/resolved event types, and deterministic JSON-ready object.

- [ ] **Step 12: Implement webhook payload construction**

Build payloads only from an explicit safe projection. Do not accept a database monitor row as input.

- [ ] **Step 13: Verify domain package**

Run: `pnpm --filter @opspulse/domain test && pnpm --filter @opspulse/domain typecheck && pnpm --filter @opspulse/domain build`

Expected: PASS.

- [ ] **Step 14: Run workspace regression**

Run: `pnpm check`

Expected: exit 0.

- [ ] **Step 15: Commit**

```bash
git add packages/domain
git commit -m "feat: implement OpsPulse reliability domain"
```

## Task 4: Durable PostgreSQL Model

**Files:**
- Create: `packages/database/drizzle.config.ts`
- Create: `packages/database/src/client.ts`
- Create: `packages/database/src/migrate.ts`
- Create: `packages/database/src/transaction.ts`
- Create: `packages/database/src/schema/auth.ts`
- Create: `packages/database/src/schema/monitors.ts`
- Create: `packages/database/src/schema/checks.ts`
- Create: `packages/database/src/schema/incidents.ts`
- Create: `packages/database/src/schema/notifications.ts`
- Create: `packages/database/src/schema/outbox.ts`
- Create: `packages/database/src/schema/workers.ts`
- Create: `packages/database/src/schema/index.ts`
- Create: `packages/database/src/index.ts`
- Create: `packages/database/migrations/0001_initial.sql`
- Create: `tests/integration/support/postgres.ts`
- Create: `tests/integration/database-schema.test.ts`

- [ ] **Step 1: Create the PostgreSQL Testcontainers helper**

Start `postgres:17-bookworm`, expose a connection URL, run migrations, truncate application tables between tests, and stop the container after the suite.

- [ ] **Step 2: Write failing auth-schema tests**

Assert one-owner uniqueness, unique email, hashed session token uniqueness, session/CSRF fields, session expiry indexes, and login-attempt account/address/time indexes.

- [ ] **Step 3: Write failing monitor/check tests**

Assert monitor type/state/lifecycle checks, generation and sequence non-negative checks, range constraints, unique public slug, one monitor-channel pair, unique `(monitor_id, generation, sequence)` request, unique check ID, optional request reference, terminal request status, and check history indexes.

- [ ] **Step 4: Write failing incident/notification tests**

Assert one-open-incident partial unique index, immutable timeline relation, active/archived channels, retained encrypted destination/signing snapshots on deliveries, unique delivery dedupe key, unique `(delivery_id, attempt_number)`, and replay foreign key.

- [ ] **Step 5: Write failing outbox/worker tests**

Assert unique outbox event ID, dispatch/retry indexes, non-negative attempts, next-attempt query index, and unique worker identity plus role with freshness index.

- [ ] **Step 6: Run integration tests and verify failure**

Run: `pnpm test:integration -- database-schema.test.ts`

Expected: FAIL because schema and migration files are absent.

- [ ] **Step 7: Implement schema modules**

Keep each file limited to the named aggregate. Put cross-aggregate relations and exported schema collection in `schema/index.ts`. Use database-native enums or check constraints consistently; do not duplicate incompatible enum definitions.

- [ ] **Step 8: Generate and inspect migration SQL**

Run: `pnpm --filter @opspulse/database drizzle-kit generate`

Expected: one initial migration. Rename it to `0001_initial.sql` if needed and inspect every constraint and index against the tests before applying it.

- [ ] **Step 9: Add required hand-written SQL**

Add the partial unique index for one open incident, any constraint not emitted by Drizzle, and comments identifying encrypted columns. Do not add a down migration; migrations are forward-only.

- [ ] **Step 10: Implement client and migration entry points**

`createDatabase(databaseUrl)` returns the typed Drizzle client and underlying `pg.Pool`. `migrateDatabase` runs checked-in migrations. `withTransaction` exposes an explicit transaction callback and helpers for row-level `FOR UPDATE`, `SKIP LOCKED`, and advisory maintenance locks.

- [ ] **Step 11: Run schema tests**

Run: `pnpm test:integration -- database-schema.test.ts`

Expected: PASS for all tables, constraints, and indexes.

- [ ] **Step 12: Verify repeatable migration application**

Run migrations twice against one fresh Testcontainers database.

Expected: first run applies `0001`; second run reports no pending migrations and leaves schema fingerprints unchanged.

- [ ] **Step 13: Add previous-version compatibility fixture**

Persist a Phase 1 schema fingerprint and a representative owner/monitor/incident data fixture. Future migration plans must start the previous image against the pre-migration schema and the new image against the migrated schema. Phase 1 establishes the fixture; it does not claim a rollback migration.

- [ ] **Step 14: Verify database package and workspace**

Run: `pnpm --filter @opspulse/database typecheck && pnpm --filter @opspulse/database build && pnpm check && pnpm test:integration`

Expected: all commands exit 0.

- [ ] **Step 15: Commit**

```bash
git add packages/database tests/integration pnpm-lock.yaml
git commit -m "feat: add OpsPulse PostgreSQL foundation"
```

## Phase 1 Completion Check

- [ ] Run `pnpm install --frozen-lockfile` from a clean checkout.
- [ ] Run `pnpm check` and confirm exit 0.
- [ ] Run `pnpm test:integration` and confirm PostgreSQL Testcontainers tests pass.
- [ ] Run `pnpm build` and confirm all three packages emit ESM JavaScript and declarations.
- [ ] Confirm generated OpenAPI contains every approved route category without exposing private monitor fields publicly.
- [ ] Confirm the pure state-machine tests cover every state-table row and ordering classification.
- [ ] Confirm PostgreSQL enforces one owner, one open incident per monitor, unique sequencing, delivery deduplication, and worker-role identity.
