# OpsPulse Contracts And Domain Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete `packages/contracts` and `packages/domain` for the approved OpsPulse design while preserving the existing database scaffold and deferring all persistence and process implementation.

**Architecture:** `@opspulse/contracts` owns strict Zod runtime schemas, exact JSON envelopes, and focused OpenAPI route registrars. `@opspulse/domain` owns pure monitor transitions, lifecycle effects, deterministic IDs, webhook construction, monitor-kind compatibility, and public-status projection; effects describe one future transaction but perform no I/O.

**Tech Stack:** Node.js 24.18.0, TypeScript 6.0.3, pnpm 10.30.3, Vitest 4.1.10, Zod 4.4.3, `@asteasolutions/zod-to-openapi` 9.1.0.

---

## Scope And References

Use `docs/superpowers/specs/2026-07-21-opspulse-design.md` as the source of truth and `docs/superpowers/plans/2026-07-21-phase-1-foundation-roadmap.md` as the sequencing reference. This plan supersedes only foundation Tasks 2 and 3. Do not add database schema, repositories, transactions, Express handlers, queues, workers, or signing code.

Preserve `isMonitorKind`: `packages/database/src/index.ts` already imports it from `@opspulse/domain`, and `packages/database/src/index.test.ts` verifies that package boundary. Do not modify either database file. Replace the domain placeholder implementation with an equivalent exported implementation in `monitor-kind.ts`, retain its adjacent tests, and run the database scaffold regression.

Production package sources must compile with `types: []` and `lib: ["ES2023"]`. They must not import or reference Node/DOM globals such as `Buffer`, `process`, `node:crypto`, `TextEncoder`, `URL`, `Request`, `Response`, `window`, or `document`.

## Execution Prerequisite

This reviewed plan is intentionally untracked while review is in progress. Before executing Task 0, commit only this plan in a separate documentation commit so later status checks are unambiguous:

```bash
git add docs/superpowers/plans/2026-07-21-phase-1b-contracts-domain.md
git diff --cached --check
git commit -m "docs: plan OpsPulse contracts and domain"
git status --short
```

Expected: the commit contains only this plan and final status is clean. Do not fold the plan into an implementation commit. This is an execution prerequisite, not an instruction to commit during the current plan-review session.

## Persistent Node 24 Wrapper

The implementation creates executable `scripts/run-node24` before any package command. It is the only approved Node/pnpm entry point when the host may run Node 25:

```bash
#!/usr/bin/env bash
set -euo pipefail
exec docker run --rm --init \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -e COREPACK_HOME=/tmp/corepack \
  -e PNPM_HOME=/tmp/pnpm \
  -e PNPM_STORE_DIR=/workspace/.pnpm-store \
  -v "$PWD:/workspace" \
  -w /workspace \
  node:24.18.0-bookworm \
  sh -lc 'if [ "$1" = pnpm ]; then shift; exec corepack pnpm "$@"; else exec "$@"; fi' sh "$@"
```

Every red/green/build/typecheck/install command below invokes `scripts/run-node24`; no shell function or host Node command is allowed.

## File Ownership

```text
packages/contracts/src/
  zod.ts                         extended shared Zod instance
  common.ts / common.test.ts     scalar, pagination, parameter schemas
  errors.ts / errors.test.ts     stable error envelope/status map
  sessions.ts / sessions.test.ts owner/session/CSRF schemas
  monitors.ts / monitors.test.ts monitor input/private response schemas
  failure-causes.ts / failure-causes.test.ts shared failure category/cause schemas
  incident-summary.ts / incident-summary.test.ts shared active-incident summary
  checks.ts / checks.test.ts     check request/run/history schemas
  heartbeats.ts / heartbeats.test.ts ping token/header/response schemas
  incidents.ts / incidents.test.ts incident lifecycle/list schemas
  incident-events.ts / incident-events.test.ts discriminated timeline events
  notification-channels.ts / notification-channels.test.ts channel commands/responses
  notification-deliveries.ts / notification-deliveries.test.ts delivery/attempt/replay
  incident-detail.ts / incident-detail.test.ts composed private incident detail envelope
  webhook.ts / webhook.test.ts   webhook v1 payload and header contracts
  dashboard.ts / dashboard.test.ts private operational summary
  public-status.ts / public-status.test.ts allowlisted public envelopes
  health.ts / health.test.ts     liveness/readiness branches
  openapi/
    registry.ts                  security/error helpers only
    sessions.ts / sessions.test.ts
    monitors.ts / monitors.test.ts
    heartbeats.ts / heartbeats.test.ts
    incidents.ts / incidents.test.ts
    channels.ts / channels.test.ts
    deliveries.ts / deliveries.test.ts
    dashboard.ts / dashboard.test.ts
    public-status.ts / public-status.test.ts
    health.ts / health.test.ts
    document.ts / document.test.ts / __snapshots__/document.test.ts.snap
  index.ts
packages/domain/src/
  monitor-kind.ts / monitor-kind.test.ts
  monitor-state.ts / monitor-state.test.ts
  monitor-lifecycle.ts / monitor-lifecycle.test.ts
  sha256.ts / sha256.test.ts
  identifiers.ts / identifiers.test.ts
  webhook-payload.ts / webhook-payload.test.ts
  public-status.ts / public-status.test.ts
  index.ts
scripts/
  run-node24                     executable Docker/Corepack wrapper
  generate-identifier-vectors.mjs independent node:crypto reference generator
packages/contracts/package.json
pnpm-lock.yaml
```

Delete only the two placeholder `index.test.ts` files after their behavior is relocated. Notification channel, delivery, and webhook contracts stay separate; do not create a large `notifications.ts`. OpenAPI registration stays split by route area; do not create an omnibus route table in production code.

## Exact Contract Exports And Shapes

All object schemas use `z.strictObject`, including nested details. Every listed schema exports the exact listed type; no catch-all inferred export language is permitted.

After each contract task turns green, add that task's named schemas/types/constants to `packages/contracts/src/index.ts` before running either package-wide suite. This incremental export is mandatory because `@opspulse/domain` resolves `@opspulse/contracts` through the built package entry. Never defer newly consumed contract exports to the final task.

### Common And Errors

`common.ts` exports `IdSchema`/`Id`, `TimestampSchema`/`Timestamp`, `CorrelationIdSchema`/`CorrelationId`, `SafeMessageSchema`/`SafeMessage`, `OutboundHttpUrlSchema`/`OutboundHttpUrl`, `PublicMonitorSlugSchema`/`PublicMonitorSlug`, `CursorSchema`/`Cursor`, `CursorQuerySchema`/`CursorQuery`, `CursorPageInfoSchema`/`CursorPageInfo`, `MonitorIdParamsSchema`/`MonitorIdParams`, `IncidentIdParamsSchema`/`IncidentIdParams`, `ChannelIdParamsSchema`/`ChannelIdParams`, `DeliveryIdParamsSchema`/`DeliveryIdParams`, `PublicSlugParamsSchema`/`PublicSlugParams`, `DEFAULT_PAGE_SIZE = 25`, and `MAX_PAGE_SIZE = 100`.

Exact shapes/rules:

```ts
type CursorQuery = { cursor?: string; limit: number }; // cursor 1..512, limit 1..100 default 25
type CursorPageInfo = { nextCursor: string | null; hasMore: boolean };
type MonitorIdParams = { monitorId: string }; // UUID; analogous exact key for other params
```

IDs are RFC 4122 UUIDs including version 8. Timestamps require valid ISO 8601 with explicit offset. Correlation IDs are trimmed 1..128; safe messages are trimmed 1..500; public slugs are lowercase `[a-z0-9]+(?:-[a-z0-9]+)*`, 1..100. `OutboundHttpUrl` is 1..2,048, valid `http`/`https`, and rejects any authority containing userinfo; monitor and channel schemas reuse it.

`errors.ts` exports `ApiErrorCodeSchema`/`ApiErrorCode`, `ApiErrorDetailSchema`/`ApiErrorDetail`, `ApiErrorSchema`/`ApiError`, `API_ERROR_STATUS`, and `ApiErrorStatus`:

```ts
type ApiErrorDetail = { field: string | null; issue: string };
type ApiError = {
  error: {
    code: ApiErrorCode;
    message: string;
    correlationId: string;
    details: ApiErrorDetail[];
  };
};
```

Codes/statuses are `invalid_request` 400, `authentication_failed` 401, `unauthenticated` 401, `csrf_invalid` 403, `forbidden` 403, `not_found` 404, `conflict` 409, `rate_limited` 429, `internal_error` 500, and `dependency_unavailable` 503. `details` is always present and may be empty.

When non-null, `ApiErrorDetail.field` is trimmed 1..128; `issue` uses `SafeMessageSchema`.

### Sessions And Health

`sessions.ts` exports these schema/type pairs: `Owner`, `SessionClient`, `OwnerSession`, `LoginRequest`, `SessionResponse`, `CurrentSessionResponse`, and `CsrfTokenResponse`.

```ts
type Owner = { id: Id; email: string; createdAt: Timestamp };
type SessionClient = { userAgent: string | null; ipAddress: string | null };
type OwnerSession = {
  id: Id;
  createdAt: Timestamp;
  lastSeenAt: Timestamp;
  idleExpiresAt: Timestamp;
  absoluteExpiresAt: Timestamp;
  client: SessionClient;
};
type LoginRequest = { email: string; password: string };
type SessionResponse = { owner: Owner; session: OwnerSession; csrfToken: string };
type CurrentSessionResponse = { owner: Owner; session: OwnerSession };
type CsrfTokenResponse = { csrfToken: string };
```

Email is trimmed/lowercased, valid, max 254. Password is 1..1024 and appears only in `LoginRequest`. User agent is nullable, max 512; IP is nullable, max 45. CSRF is base64url 43..128. Session timestamps are required, not defaulted.

`health.ts` exports schema/type pairs `HealthService` (`api|worker`), `DependencyName` (`postgres|redis`), `DependencyHealth`, `LivenessResponse`, `ReadyResponse`, `NotReadyResponse`, and `ReadinessResponse`:

```ts
type LivenessResponse = { service: HealthService; status: "alive"; checkedAt: Timestamp };
type DependencyHealth = { name: DependencyName; ok: boolean; safeMessage: string | null };
type ReadyResponse = { service: HealthService; status: "ready"; checkedAt: Timestamp; dependencies: DependencyHealth[] };
type NotReadyResponse = { service: HealthService; status: "not_ready"; checkedAt: Timestamp; dependencies: DependencyHealth[] };
```

`ReadinessResponseSchema` is the union. Ready requires every dependency `ok`; not-ready requires at least one false. Each dependency name occurs exactly once. OpenAPI uses `ReadyResponseSchema` for 200 and `NotReadyResponseSchema` for 503, never the union for either response.

### Monitors

`monitors.ts` exports schema/type pairs `MonitorKind`, `MonitorState`, `MonitorLifecycle`, `HttpMethod`, `AcceptedStatusRange`, `RequestHeader`, `HttpMonitorInput`, `HeartbeatMonitorInput`, `CreateMonitor`, `UpdateHttpMonitor`, `UpdateHeartbeatMonitor`, `UpdateMonitor`, `PrivateHttpMonitor`, `PrivateHeartbeatMonitor`, `PrivateMonitor`, `MonitorListQuery`, `MonitorListResponse`, `MonitorResponse`, `CreateMonitorResponse`, `LifecycleCommandResponse`, `HeartbeatTokenResponse`, and `ReplaceMonitorChannels`. It imports `IncidentSummary` from its cycle-free focused owner `incident-summary.ts`.

Enums are kind `http|heartbeat`, state `pending|up|degraded|down`, lifecycle `active|paused|archived`, method `GET|HEAD`, and public flag boolean. Create defaults: interval 60 in range 30..86,400; failure threshold 2 and recovery threshold 1 in range 1..10; `published=false`. Name is trimmed 1..100.

```ts
type AcceptedStatusRange = { min: number; max: number }; // integers 100..599; defaults 200/399; min <= max
type RequestHeader = { name: string; value: string };
type HttpMonitorInput = {
  kind: "http"; name: string; published: boolean; intervalSeconds: number;
  failureThreshold: number; recoveryThreshold: number; url: string;
  method: HttpMethod; timeoutSeconds: number; acceptedStatus: AcceptedStatusRange;
  headers: RequestHeader[];
};
type HeartbeatMonitorInput = {
  kind: "heartbeat"; name: string; published: boolean; intervalSeconds: number;
  failureThreshold: number; recoveryThreshold: number; gracePeriodSeconds: number;
};
```

URL uses `OutboundHttpUrlSchema`. Timeout defaults 5, range 1..30. Headers default `[]`, max 20; names are RFC token syntax 1..128, values 0..1,024, and names are unique case-insensitively. Normalize the name to lowercase for inspection and reject when it equals `authorization`, `proxy-authorization`, `cookie`, `set-cookie`, or `host`, or matches `/(^|[-_])(auth|token|api[-_]?key|secret|credential|password)([-_]|$)/`. Reject a value when trimmed value starts case-insensitively with `basic `, `bearer `, or `token `; matches a three-segment base64url JWT; or contains `AKIA` followed by 16 uppercase alphanumerics. Keep the original name/value in successful output.

Update schemas require immutable `kind`, have no defaults, accept only mutable input fields, and require at least one change. They reject state/lifecycle/counters/generation/sequences/token/timestamps. Replacing channels is `{ channelIds: Id[] }`, unique, max 100.

Every private monitor contains these common exact fields:

```ts
type PrivateMonitorBase = {
  id: Id; kind: MonitorKind; name: string; state: MonitorState; lifecycle: MonitorLifecycle;
  published: boolean; publicSlug: PublicMonitorSlug | null; intervalSeconds: number;
  failureThreshold: number; recoveryThreshold: number; consecutiveFailures: number;
  consecutiveSuccesses: number; generation: number; nextSequence: number;
  lastEvaluatedSequence: number; lastEvaluatedCheckAt: Timestamp | null;
  activeIncident: IncidentSummary | null; notificationChannelIds: Id[];
  createdAt: Timestamp; updatedAt: Timestamp;
};
```

Generation/last sequence are non-negative safe integers; `nextSequence >= 1` and `nextSequence > lastEvaluatedSequence`. HTTP adds URL, method, timeout, accepted status, headers, and `nextCheckAt: Timestamp|null`. Heartbeat adds grace, `lastHeartbeatAt: Timestamp|null`, and `nextHeartbeatDeadline: Timestamp|null`. `IncidentSummary` is `{ id, status:"open", startedAt, latestCause }`.

Envelopes are `MonitorResponse = { monitor }`, `MonitorListResponse = { items: PrivateMonitor[]; page: CursorPageInfo }`, and lifecycle response `{ monitor }`. `CreateMonitorResponse` is a kind-discriminated union: HTTP `{ monitor }`; heartbeat `{ monitor; heartbeat: { token; pingPath } }`. `HeartbeatTokenResponse` is `{ token; pingPath; rotatedAt }`. Token and token-bearing relative path occur only in those two one-time responses.

`MonitorListQuery` is cursor/limit plus optional `kind`, `state`, `lifecycle`, and `published`. Monitor lists are stable newest-first by `(createdAt,id)` as documented in OpenAPI; the cursor remains opaque.

### Checks, Heartbeats, Incidents, And Timeline

`failure-causes.ts` is the sole owner and exports `FailureCategorySchema`/`FailureCategory` and `FailureCauseSchema`/`FailureCause`. Categories are `http_status|timeout|dns|connection|tls|network|heartbeat_late|unknown`. Cause is exact `{category,code,httpStatus,safeSummary}`; code is null or `[A-Z0-9_-]{1,64}`, status is null or 100..599, `http_status` requires a status, every other category requires null, and summary is safe text.

`incident-summary.ts` exports `IncidentSummarySchema`/`IncidentSummary` as exact `{id:Id,status:"open",startedAt:Timestamp,latestCause:FailureCause}`. The literal open status is mandatory, so private/domain `activeIncident` can never contain a resolved incident. Monitor and dashboard modules import this schema; no module redeclares it.

`checks.ts` imports `FailureCause` and exports schema/type pairs `CheckRequestSource`, `CheckRequestStatus`, `CheckResult`, `CheckRequest`, `CheckRun`, `MonitoringError`, `PendingCheckHistoryItem`, `CompletedCheckHistoryItem`, `CancelledCheckHistoryItem`, `CheckHistoryItem`, `CheckListQuery`, and `CheckListResponse`.

```ts
type CheckRequestSource = "http_schedule" | "heartbeat_ping" | "heartbeat_deadline";
type CheckRequestStatus = "pending" | "completed" | "cancelled-internal";
type CheckResult = "success" | "failure" | "timeout";
type CheckRequest = {
  id: Id; monitorId: Id; generation: number; sequence: number; source: CheckRequestSource;
  scheduledAt: Timestamp; status: CheckRequestStatus; createdAt: Timestamp;
  terminalAt: Timestamp | null;
};
type CheckRun = {
  id: Id; checkRequestId: Id | null; monitorId: Id; generation: number; sequence: number;
  result: CheckResult; httpStatus: number | null; latencyMs: number | null;
  cause: FailureCause | null; completedAt: Timestamp; createdAt: Timestamp;
  evaluatedAt: Timestamp | null;
};
type MonitoringError = { safeSummary: string; recordedAt: Timestamp };
```

Generation is non-negative; sequence is safe integer >=1. Success requires null cause; failure/timeout require cause. HTTP status is null or 100..599; latency is null or non-negative integer. History is discriminated by request status: pending `{request,run:null,monitoringError:null}`, completed `{request,run,monitoringError:null}`, cancelled `{request,run:null,monitoringError}`. Query is cursor/limit plus optional `result`, `from`, and `to`; `from <= to`. Response is `{items,page}`.

`CheckRequestSchema` refines status/time exactly: pending requires `terminalAt:null`; completed and cancelled-internal require non-null `terminalAt >= createdAt`. `CheckRun.httpStatus`, failure-cause status, delivery/attempt response statuses are integer 100..599 whenever non-null. `MonitoringError.safeSummary`, `CancelledTerminalCheck.safeError`, delivery `lastSafeError`, and attempt `safeError` use `SafeMessageSchema` whenever non-null.

Check history is stable newest-first by `(scheduledAt,id)`. Incident, channel, and delivery list responses use `(createdAt,id)` newest-first. Every registrar documents its ordering and every list-schema test asserts that the corresponding OpenAPI query has an opaque cursor rather than offset/page fields.

`heartbeats.ts` exports `HeartbeatTokenParamsSchema`/`HeartbeatTokenParams`, `HeartbeatHeadersSchema`/`HeartbeatHeaders`, and `HeartbeatAcceptedSchema`/`HeartbeatAccepted`. Token is base64url 43..128. Headers are exact `{ "idempotency-key"?: string }`, trimmed 1..255. Accepted is `{ checkId: Id; receivedAt: Timestamp; deduplicated: boolean }`.

`incidents.ts` imports `FailureCause` and exports schema/type pairs `IncidentStatus`, `ResolutionReason`, `Incident`, `IncidentListQuery`, and `IncidentListResponse`:

```ts
type FailureCause = {
  category: FailureCategory;
  code: string | null;
  httpStatus: number | null;
  safeSummary: string;
};
type Incident = {
  id: Id; monitorId: Id; monitorName: string; status: "open"|"resolved";
  startedAt: Timestamp; resolvedAt: Timestamp | null; openingCause: FailureCause;
  latestCause: FailureCause; resolutionReason: ResolutionReason | null;
};
```

Open incident requires null resolution fields; resolved requires both. List query is cursor/limit plus optional monitor ID, status, from, to; response `{items,page}`. `IncidentSummarySchema` remains the focused owner used by monitor and dashboard modules.

`incident-events.ts` exports `OpenedDetailsSchema`/`OpenedDetails`, `FailureObservedDetailsSchema`/`FailureObservedDetails`, `NotificationQueuedDetailsSchema`/`NotificationQueuedDetails`, `RecoveryObservedDetailsSchema`/`RecoveryObservedDetails`, `ResolvedDetailsSchema`/`ResolvedDetails`, `OpenedIncidentEventSchema`/`OpenedIncidentEvent`, `FailureObservedIncidentEventSchema`/`FailureObservedIncidentEvent`, `NotificationQueuedIncidentEventSchema`/`NotificationQueuedIncidentEvent`, `RecoveryObservedIncidentEventSchema`/`RecoveryObservedIncidentEvent`, `ResolvedIncidentEventSchema`/`ResolvedIncidentEvent`, and `IncidentEventSchema`/`IncidentEvent`. Each event has `{id,incidentId,type,occurredAt,details}` with exact details:

```ts
type OpenedDetails = { cause: FailureCause };
type FailureObservedDetails = { previousCause: FailureCause; nextCause: FailureCause };
type NotificationQueuedDetails = { deliveryId: Id; channelId: Id; payloadVersion: "opspulse.webhook.v1" };
type RecoveryObservedDetails = { consecutiveSuccesses: number; recoveryThreshold: number };
type ResolvedDetails = { reason: "recovered" | "monitor_archived" };
```

The event `type` discriminants are `opened`, `failure_observed`, `notification_queued`, `recovery_observed`, and `resolved`; no generic details record is allowed.

### Notification Channels, Deliveries, And Webhook

`notification-channels.ts` exports schema/type pairs `ChannelLifecycle`, `CreateNotificationChannel`, `UpdateNotificationChannel`, `NotificationChannel`, `ChannelResponse`, `ChannelListQuery`, `ChannelListResponse`, and `TestChannelResponse`.

Create is `{name,url,signingSecret,enabled}` with name 1..100, `OutboundHttpUrlSchema`, secret 32..1,024, enabled default true. Update is a non-empty partial of those fields without defaults. Response is exactly `{id,name,enabled,lifecycle:"active"|"archived",destinationConfigured:true,hasSigningSecret:true,createdAt,updatedAt}` and never contains URL/secret. List query adds `lifecycle` to cursor/limit; envelopes are `{channel}` and `{items,page}`. Test response is `{deliveryId: Id; queuedAt: Timestamp}`.

`notification-deliveries.ts` exports schema/type pairs `DeliveryStatus`, `AttemptOutcome`, `NotificationAttempt`, `QueuedDelivery`, `RetryingDelivery`, `DeliveredDelivery`, `FailedDelivery`, `NotificationDelivery`, `DeliveryListQuery`, `DeliveryListResponse`, and `ReplayDelivery`.

Common delivery fields are `{id,incidentEventId,channelId,deduplicationKey,replayOfDeliveryId,attemptCount,lastResponseStatus,lastSafeError,nextAttemptAt,attempts,createdAt,updatedAt}`. `attempts` is a readonly array of `NotificationAttempt`, maximum 6, sorted by attempt number ascending, with unique IDs/numbers and every `deliveryId` equal to the enclosing delivery ID. `attemptCount === attempts.length`. Dedupe key is 1..512; replay ID nullable; attempts integer 0..6. Exact status branches:

- `queued`: attempt 0, response/error null, `nextAttemptAt` non-null.
- `retrying`: attempts 1..5, `nextAttemptAt` non-null, response/error nullable but at least one non-null.
- `delivered`: attempts 1..6, response 200..299, error/next null.
- `failed`: attempts 1..6, next null, response/error nullable but at least one non-null.

Attempt is `{id,deliveryId,attemptNumber:1..6,startedAt,completedAt,outcome:"delivered"|"retryable_failure"|"final_failure",responseStatus:number|null,safeError:string|null}`; delivered requires 2xx and null error, failure requires response or error. List query is cursor/limit plus optional status, monitor ID, channel ID, from, to; response `{items:NotificationDelivery[],page}` with default 25 and maximum 100 deliveries and therefore at most 600 attempts per page. Replay body is exactly `{confirmed:true}`. Attempts are exposed through approved list and incident-detail envelopes only; there is no delivery-detail operation.

`incident-detail.ts` exports `IncidentDetailResponseSchema`/`IncidentDetailResponse` as exact `{incident:Incident,timeline:IncidentEvent[],deliveries:NotificationDelivery[]}`. It is created only after all three focused owner modules exist, preventing contract import cycles.

`webhook.ts` exports `WebhookEventTypeSchema`/`WebhookEventType`, `OpenedWebhookSchema`/`OpenedWebhook`, `ResolvedWebhookSchema`/`ResolvedWebhook`, `OpsPulseWebhookV1Schema`/`OpsPulseWebhookV1`, `WEBHOOK_PAYLOAD_VERSION`, and `WEBHOOK_HEADER_NAMES`. Exact payload:

```ts
type WebhookBase = {
  version: "opspulse.webhook.v1"; eventId: Id;
  eventType: "incident.opened" | "incident.resolved"; occurredAt: Timestamp;
  monitor: { slug: PublicMonitorSlug; name: string; state: MonitorState };
  incident: { id: Id; startedAt: Timestamp; resolvedAt: Timestamp | null };
};
type OpenedWebhook = WebhookBase & {
  eventType: "incident.opened"; monitor: WebhookBase["monitor"] & {state:"down"};
  incident: WebhookBase["incident"] & {resolvedAt:null};
  summary: {message:string; cause:FailureCause; resolution:null};
};
type ResolvedWebhook = WebhookBase & {
  eventType: "incident.resolved"; incident: WebhookBase["incident"] & {resolvedAt:Timestamp};
  summary: {message:string; cause:null; resolution:"recovered"|"monitor_archived"};
};
```

Recovered requires monitor state up; archived allows any internal state. Header constants map logical keys to exact names `X-OpsPulse-Event-ID`, `X-OpsPulse-Timestamp`, `X-OpsPulse-Signature-Version`, `X-OpsPulse-Signature`, and `X-OpsPulse-Replay-Of`. These are outbound webhook headers; heartbeat inbound headers remain the lowercase JSON key defined above.

### Dashboard And Public Status

`dashboard.ts` exports schema/type pairs `WorkerRole`, `WorkerFreshness`, `MonitorCounts`, `DashboardCounts`, `LatencySummary`, `DashboardSummary`, and `DashboardSummaryResponse`:

```ts
type WorkerFreshness = {
  role: "scheduler"|"checker"|"outbox_dispatcher"|"notifier";
  healthy: boolean; freshInstanceCount: number; lastSeenAt: Timestamp|null; ageSeconds: number|null;
};
type MonitorCounts = { pending:number; up:number; degraded:number; down:number; paused:number };
type DashboardCounts = {
  monitors: MonitorCounts; openIncidents:number; failedDeliveries:number; internalMonitoringErrors:number;
};
type LatencySummary = { p50Ms:number; p95Ms:number; p99Ms:number };
type DashboardSummary = {
  generatedAt:Timestamp; monitoringAvailable:boolean; workers:WorkerFreshness[];
  counts:DashboardCounts; latency:LatencySummary|null; activeIncidents:IncidentSummary[];
};
type DashboardSummaryResponse = { data: DashboardSummary };
```

Counts/latencies are non-negative integers; exactly one worker row per role; null freshness fields occur together. Healthy means age <=60. Monitoring available requires healthy scheduler and checker.

`public-status.ts` exports schema/type pairs `PublicMonitorState`, `PublicAggregateState`, `PublicIncident`, `PublicActiveIncident`, `PublicMonitor`, `PublicStatus`, `PublicStatusResponse`, and `PublicMonitorResponse`:

```ts
type PublicIncident = { id:Id; status:IncidentStatus; startedAt:Timestamp; resolvedAt:Timestamp|null; summary:string };
type PublicActiveIncident = PublicIncident & {status:"open"; resolvedAt:null};
type PublicMonitor = {
  slug:PublicMonitorSlug; name:string;
  state:"unknown"|"operational"|"degraded"|"outage"|"maintenance";
  activeIncident:PublicActiveIncident|null; updatedAt:Timestamp;
};
type PublicStatus = {
  aggregate:"unknown"|"operational"|"degraded"|"outage";
  monitoringAvailable:boolean; generatedAt:Timestamp; historyWindowDays:90;
  monitors:PublicMonitor[]; incidents:PublicIncident[];
};
type PublicStatusResponse = { data: PublicStatus };
type PublicMonitorResponse = { data: { monitor:PublicMonitor; incidents:PublicIncident[]; historyWindowDays:90 } };
```

There is no public history query. The server supplies a fixed rolling 90-day window; the pure projection filters older incidents. Public schemas are authored from allowlists, never `pick`/`omit` from private schemas.

`PublicIncidentSchema` refines status/time: open requires `resolvedAt:null`; resolved requires non-null `resolvedAt >= startedAt`. `PublicActiveIncidentSchema` accepts only the open/null branch. Neither has a monitor ID or slug. Monitor association exists only in domain projection input and is stripped before either public envelope is returned.

State projection is exact: pending to unknown, up to operational, degraded to degraded, down to outage, and any paused lifecycle to maintenance. Aggregate ignores maintenance and orders outage over degraded over operational; no active non-maintenance monitor yields unknown. `PublicIncident.summary` uses `SafeMessageSchema`.

## Exact OpenAPI Contract

`openapi/registry.ts` exports `createRegistry`, `registerSecuritySchemes`, and status-specific error-response helpers. Every operation registers `500 internal_error`. A path UUID/slug validation failure registers `400 invalid_request`. Private routes use `ownerSession` cookie security; mutations use one requirement object containing both `ownerSession` and `csrfToken`. Public/heartbeat/health routes use `security: []`. A 204 response has description only and no `content` key.

OpenAPI registers inbound heartbeat `Idempotency-Key` as one optional header parameter using the value schema from `HeartbeatHeadersSchema`; it does not register a JSON headers object. Outbound webhook header constants are documentation components only and never appear as heartbeat request headers.

| Method/path | ID | Request schema(s) | Success | Other exact errors |
| --- | --- | --- | --- | --- |
| `POST /v1/sessions` | `createSession` | body `LoginRequest` | 200 `SessionResponse` | 400 invalid, 401 authentication_failed, 429 rate_limited |
| `GET /v1/sessions/current` | `getCurrentSession` | none | 200 `CurrentSessionResponse` | 401 unauthenticated |
| `DELETE /v1/sessions/current` | `deleteCurrentSession` | `X-CSRF-Token` | 204 no body/content | 401 unauthenticated, 403 csrf_invalid |
| `GET /v1/sessions/csrf` | `rotateCsrfToken` | none | 200 `CsrfTokenResponse` | 401 unauthenticated |
| `POST /v1/monitors` | `createMonitor` | body `CreateMonitor` | 201 `CreateMonitorResponse` | 400 invalid, 401 unauthenticated, 403 csrf_invalid, 409 conflict |
| `GET /v1/monitors` | `listMonitors` | query `MonitorListQuery` | 200 `MonitorListResponse` | 400 invalid, 401 unauthenticated |
| `GET /v1/monitors/{monitorId}` | `getMonitor` | path `MonitorIdParams` | 200 `MonitorResponse` | 400 invalid, 401 unauthenticated, 404 not_found |
| `PATCH /v1/monitors/{monitorId}` | `updateMonitor` | path + body `UpdateMonitor` | 200 `MonitorResponse` | 400 invalid, 401, 403 csrf_invalid, 404, 409 |
| `POST /v1/monitors/{monitorId}/pause` | `pauseMonitor` | path; no body | 200 `LifecycleCommandResponse` | 400 invalid, 401, 403, 404, 409 |
| `POST /v1/monitors/{monitorId}/resume` | `resumeMonitor` | path; no body | 200 `LifecycleCommandResponse` | 400 invalid, 401, 403, 404, 409 |
| `POST /v1/monitors/{monitorId}/archive` | `archiveMonitor` | path; no body | 200 `LifecycleCommandResponse` | 400 invalid, 401, 403, 404, 409 |
| `POST /v1/monitors/{monitorId}/heartbeat-token` | `rotateHeartbeatToken` | path; no body | 200 `HeartbeatTokenResponse` | 400 invalid, 401, 403, 404, 409 non-heartbeat/archived |
| `PUT /v1/monitors/{monitorId}/channels` | `replaceMonitorChannels` | path + body `ReplaceMonitorChannels` | 200 `MonitorResponse` | 400 invalid, 401, 403, 404, 409 |
| `GET /v1/monitors/{monitorId}/checks` | `listMonitorChecks` | path + query `CheckListQuery` | 200 `CheckListResponse` | 400 invalid, 401, 404 |
| `POST /v1/heartbeats/{token}` | `receiveHeartbeat` | path `HeartbeatTokenParams`, header `HeartbeatHeaders`, no body | 202 `HeartbeatAccepted` | 400 invalid, 404 not_found, 429 rate_limited |
| `GET /v1/incidents` | `listIncidents` | query `IncidentListQuery` | 200 `IncidentListResponse` | 400 invalid, 401 |
| `GET /v1/incidents/{incidentId}` | `getIncident` | path `IncidentIdParams` | 200 `IncidentDetailResponse` | 400 invalid, 401, 404 |
| `POST /v1/channels` | `createChannel` | body `CreateNotificationChannel` | 201 `ChannelResponse` | 400 invalid, 401, 403, 409 |
| `GET /v1/channels` | `listChannels` | query `ChannelListQuery` | 200 `ChannelListResponse` | 400 invalid, 401 |
| `PATCH /v1/channels/{channelId}` | `updateChannel` | path + body `UpdateNotificationChannel` | 200 `ChannelResponse` | 400 invalid, 401, 403, 404, 409 |
| `POST /v1/channels/{channelId}/archive` | `archiveChannel` | path; no body | 200 `ChannelResponse` | 400 invalid, 401, 403, 404, 409 |
| `POST /v1/channels/{channelId}/test` | `testChannel` | path; no body | 202 `TestChannelResponse` | 400 invalid, 401, 403, 404, 409 |
| `GET /v1/deliveries` | `listDeliveries` | query `DeliveryListQuery` | 200 `DeliveryListResponse` | 400 invalid, 401 |
| `POST /v1/deliveries/{deliveryId}/replay` | `replayDelivery` | path + body `ReplayDelivery` | 201 `NotificationDelivery` | 400 invalid, 401, 403, 404, 409 not final-failed |
| `GET /v1/dashboard` | `getDashboardSummary` | none | 200 `DashboardSummaryResponse` | 401 unauthenticated |
| `GET /v1/status` | `getPublicStatus` | none; fixed 90 days | 200 `PublicStatusResponse` | 429 rate_limited |
| `GET /v1/status/monitors/{slug}` | `getPublicMonitor` | path `PublicSlugParams`; fixed 90 days | 200 `PublicMonitorResponse` | 400 invalid, 404, 429 |
| `GET /health/live` | `getLiveness` | none | 200 `LivenessResponse` | 500 |
| `GET /health/ready` | `getReadiness` | none | 200 `ReadyResponse` | 503 `NotReadyResponse` dependency_unavailable, 500 |

Rows marked `no body` must omit `requestBody` entirely. In the table, every abbreviated private `401` means `unauthenticated`, every abbreviated mutation `403` means `csrf_invalid`, every `404` means `not_found`, and every `409` means `conflict`; registrars must use those exact codes. `forbidden` is defined for later authorization use but is not registered on these single-owner routes. Readiness 503 is the sole deliberate exception to the API error envelope: generic registrar assertions must skip only `(operationId:getReadiness,status:503)`, and `openapi/health.test.ts` must instead assert exact `NotReadyResponseSchema` content and no `ApiErrorSchema` ref. Unexpected readiness failures remain 500 `ApiErrorSchema`. The heartbeat token is a required path credential, not an OpenAPI security scheme; its operation description says it authorizes only that monitor ping and it must not inherit cookie/CSRF security.

`openapi/document.ts` exports `createOpenApiDocument` and `OpenApiDocument`. Every registrar exports exactly one function named `registerSessionOperations`, `registerMonitorOperations`, `registerHeartbeatOperations`, `registerIncidentOperations`, `registerChannelOperations`, `registerDeliveryOperations`, `registerDashboardOperations`, `registerPublicStatusOperations`, or `registerHealthOperations`.

## Exact Domain Model And Effects

`monitor-kind.ts` exports `isMonitorKind(value: string): value is MonitorKind` and preserves `http|heartbeat` behavior.

`monitor-state.ts` exports `MonitorSnapshot`, `CompletedTerminalCheck`, `CancelledTerminalCheck`, `TerminalCheck`, `EvaluationContext`, `IncidentRef`, `TimelineRef`, `DeliveryRef`, `MonitorEffect`, `MonitorTransition`, `MonitorInvariantError`, `materiallyChangedCause`, and `evaluateMonitorResult`:

```ts
type MonitorSnapshot = {
  monitorId: Id; lifecycle:"active"|"paused"|"archived";
  state:"pending"|"up"|"degraded"|"down"; generation:number;
  lastEvaluatedSequence:number; consecutiveFailures:number; consecutiveSuccesses:number;
  failureThreshold:number; recoveryThreshold:number;
  activeIncident:{id:Id; status:"open"; cause:FailureCause}|null;
};
type CompletedTerminalCheck = {
  status:"completed"; requestId:Id; checkId:Id; generation:number; sequence:number;
  result:"success"|"failure"|"timeout"; cause:FailureCause|null; occurredAt:Timestamp;
};
type CancelledTerminalCheck = {
  status:"cancelled-internal"; requestId:Id; generation:number; sequence:number;
  safeError:string; occurredAt:Timestamp;
};
type EvaluationContext = {notificationChannelIds:readonly Id[]; proposedIncidentId:Id|null};
type IncidentRef = {kind:"existing"|"proposed"; incidentId:Id};
type TimelineRef = {kind:"timeline_effect"; effectIndex:number};
type DeliveryRef = {kind:"delivery_effect"; effectIndex:number};
```

`evaluateMonitorResult(snapshot, check, context)` validates/sorts unique channel UUIDs before effects. If a current, next-sequence completed failure/timeout has no active incident, `proposedIncidentId` must be a valid UUID because threshold evaluation may open; the caller contract is to supply `createIncidentId({monitorId,generation,openingCheckId:checkId})`. The evaluator does not recompute it. For current active-incident, success, or cancelled consumption it must be null. Stale/gap returns do not inspect context. A below-threshold failure may leave the valid proposal unused. An opening uses that ID in the next snapshot and every effect, eliminating persistence-time incident-ID circularity. `MonitorTransition = {snapshot; effects: readonly MonitorEffect[]}`. Effect union is exact:

```ts
type MonitorEffect =
  | {type:"evaluation.wait"; expectedSequence:number; receivedSequence:number}
  | {type:"result.ignore"; reason:"stale_generation"|"stale_sequence"}
  | {type:"monitoring.error.record"; requestId:Id; safeError:string; occurredAt:Timestamp}
  | {type:"schedule.cancel_generation"; generation:number}
  | {type:"schedule.initialize"; generation:number}
  | {type:"incident.open"; incidentId:Id; cause:FailureCause; occurredAt:Timestamp}
  | {type:"incident.observe"; incident:IncidentRef; previousCause:FailureCause; nextCause:FailureCause; occurredAt:Timestamp}
  | {type:"incident.resolve"; incident:IncidentRef; reason:"recovered"|"monitor_archived"; occurredAt:Timestamp}
  | {type:"timeline.append"; incident:IncidentRef; event:"opened"; details:OpenedDetails; occurredAt:Timestamp}
  | {type:"timeline.append"; incident:IncidentRef; event:"failure_observed"; details:FailureObservedDetails; occurredAt:Timestamp}
  | {type:"timeline.append"; incident:IncidentRef; event:"recovery_observed"; details:RecoveryObservedDetails; occurredAt:Timestamp}
  | {type:"timeline.append"; incident:IncidentRef; event:"resolved"; details:ResolvedDetails; occurredAt:Timestamp}
  | {type:"delivery.create"; incidentEvent:TimelineRef; channelId:Id; payloadVersion:"opspulse.webhook.v1"; replayOfDeliveryId:null}
  | {type:"timeline.append"; incident:IncidentRef; event:"notification_queued"; details:{delivery:DeliveryRef; channelId:Id; payloadVersion:"opspulse.webhook.v1"}; occurredAt:Timestamp}
  | {type:"outbox.enqueue"; eventType:"notification.requested"; aggregateType:"notification_delivery"; aggregate:DeliveryRef; channelId:Id; payloadVersion:"opspulse.webhook.v1"};
```

Effect indices reference the zero-based position in the final effects array. Future persistence replaces refs with generated IDs and computes delivery/outbox IDs from the referenced timeline/delivery IDs. Snapshot update is persisted before effects. Exact one-channel arrays are:

- Opening: index 0 incident open with the proposed ID; 1 opened timeline with `{kind:"proposed",incidentId}`; 2 delivery create referencing timeline 1; 3 notification-queued timeline referencing delivery 2; 4 outbox referencing delivery 2. The returned snapshot's active incident uses the same proposed ID.
- Recovery: index 0 recovery-observed timeline; 1 incident resolve; 2 resolved timeline; 3 delivery referencing timeline 2; 4 notification-queued referencing delivery 3; 5 outbox referencing delivery 3.
- Archive with incident: index 0 cancel old generation; 1 incident resolve; 2 resolved timeline; 3 delivery referencing timeline 2; 4 notification-queued referencing delivery 3; 5 outbox referencing delivery 3. Archive without incident emits only index 0 cancel.
- Material observation: index 0 incident observe; 1 failure-observed timeline. Pause emits only cancel; resume emits cancel then initialize.

For additional channels, append each sorted channel's complete delivery/timeline/outbox triple before the next channel. No notification effects are emitted when the channel list is empty.

Evaluation precedence is exact. First validate only structural identity/version fields needed to classify work: monitor/request/check UUIDs, generations as non-negative safe integers, and terminal sequence >=1. Second compare generation; any mismatch returns only stale-generation ignore even when snapshot lifecycle is paused/archived. Third classify sequence <= last as stale and > last+1 as wait without lifecycle checks. Only an exact current-generation next sequence can consume, and it requires `lifecycle:"active"`; paused/archived current-generation consumption throws `MonitorInvariantError`. Then validate thresholds/counters, cause/safe-error/time invariants, context proposal/channel IDs, and state/incident invariants: up requires null incident, down requires open incident, pending/degraded allow either, and every non-null incident has literal status open. Cancelled-internal advances only last sequence and emits only monitoring-error. Success resets failures/increments successes; failure/timeout resets successes/increments failures.

`materiallyChangedCause` compares only category, `code`, and `httpStatus`; summary wording is ignored. Pending semantics after resume with retained incident are explicit:

- pending success below recovery remains pending, retains incident, and appends recovery-observed.
- pending success reaching recovery becomes up and emits the full recovery sequence.
- pending failure below threshold becomes degraded, retains incident, never opens another incident, and observes only a material cause change.
- pending failure reaching threshold becomes down; with retained incident it observes then timelines but does not open/notify, while without incident it runs the opening sequence.

All degraded success/failure combinations are also tested with and without an incident. A degraded success reaching threshold resolves only when an incident exists; otherwise it becomes up silently. Continuing down failure observes only material changes.

Remaining exact rows: pending failure below threshold becomes degraded and pending success below threshold remains pending; without a retained incident they emit no incident effects. Up success remains up and resets counters; up failure below threshold becomes degraded; up failure at threshold becomes down and opens. Degraded failure below threshold remains degraded; at threshold it becomes down and opens only if no incident exists. Down success below recovery becomes degraded with its incident open and recovery-observed; at threshold it becomes up and resolves. Down failure remains down and observes only a material cause change.

`monitor-lifecycle.ts` exports `MonitorLifecycleConflictError`, `pauseMonitor(snapshot)`, `resumeMonitor(snapshot)`, and `archiveMonitor(snapshot, occurredAt, notificationChannelIds)`. Pause increments generation, resets last sequence, retains state/counters/incident, and cancels old generation. Resume increments generation, sets active/pending, resets counters/sequence, retains incident, then emits cancel-old and initialize-new. Archive validates canonical `occurredAt` and channel UUIDs, increments generation, resets sequence, preserves target state/counters, cancels old generation first, and if an incident exists emits the archive resolution sequence above. Archived is immutable; invalid lifecycle commands throw conflict before output.

## Later-Phase Handoff

These approved requirements are intentionally not runtime-enforced in contracts/domain because they need HTTP, persistence, worker, or scheduler implementation. Preserve them in later plans:

| Requirement | Exact policy | Owning later phase |
| --- | --- | --- |
| Redirects/SSRF | max 3; re-resolve, validate, and pin every destination; ignore proxies | safe outbound client |
| Response body | read/discard max 64 KiB; never persist | HTTP checker |
| Check retention | configurable 1..365 days, default 30 | database/config maintenance |
| Public history | server selects/filter rolling max 90 days | API repository plus pure projection |
| Heartbeat elapsed deadlines | materialize/evaluate at most 100 per transaction before ping | heartbeat transaction |
| Checker internal retry | six attempts; then cancelled-internal | worker checker |
| Pending request reaper | cancel older than `2 * timeoutSeconds + 60s` | worker reaper |
| Webhook transport | 5s timeout, no redirects, 64 KiB response cap, 2xx success | notifier |
| Webhook retry | retry network/408/425/429/5xx, final other 4xx, six attempts, bounded exponential jitter | notifier |
| Worker heartbeat | every scheduler/checker/outbox-dispatcher/notifier instance writes its role heartbeat every 15s; freshness expires after 60s | worker roles/database |
| Check scheduling | one pending HTTP request; missed intervals collapse to one current check; creation/resume initialize due time | scheduler/database |
| Generation changes | increment/reset generation-scoped sequences and cancel old pending requests when HTTP URL, method, headers, timeout, accepted status, or interval changes; when heartbeat interval/grace changes; and on pause, resume, or archive. Name, published flag, public slug, thresholds, and channel assignments do not change generation | monitor service/scheduler/database |

## Chunk 1: Exact Runtime Contracts

### Task 0: Check In The Persistent Node Wrapper

**Files:**
- Create: `scripts/run-node24`

- [ ] **Step 1: Create the wrapper** with the exact script from Persistent Node 24 Wrapper.
- [ ] **Step 2: Set executable mode:** `chmod +x scripts/run-node24 && test -x scripts/run-node24`; expected exit 0.
- [ ] **Step 3: Verify runtime:** `scripts/run-node24 node --version`; expected exactly `v24.18.0`.
- [ ] **Step 4: Verify Corepack:** `scripts/run-node24 pnpm --version`; expected exactly `10.30.3`.
- [ ] **Step 5: Verify tracked mode:** `git add scripts/run-node24 && git diff --cached --summary`; expected `create mode 100755 scripts/run-node24`.
- [ ] **Step 6: Commit:** `git commit -m "chore: add Node 24 command wrapper"`.

### Task 1: Common, Error, Session, And Health Modules

**Files:** `packages/contracts/package.json`, `pnpm-lock.yaml`, `zod.ts`, `common.ts/test`, `errors.ts/test`, `failure-causes.ts/test`, `incident-summary.ts/test`, `sessions.ts/test`, `health.ts/test`.

- [ ] **Step 1: Write `common.test.ts` first** with 22 cases: UUID/v8, timestamps, safe strings, slug, every cursor boundary/default, exact params, and nested unknown rejection.
- [ ] **Step 2: Run red:** `scripts/run-node24 pnpm --filter @opspulse/contracts test -- common.test.ts`; expected FAIL missing `common.ts`.
- [ ] **Step 3: Add exact dependencies** `zod: 4.4.3` and `@asteasolutions/zod-to-openapi: 9.1.0`, run `scripts/run-node24 pnpm install`, and implement `zod.ts` plus common exports.
- [ ] **Step 4: Run green:** `scripts/run-node24 pnpm --filter @opspulse/contracts test -- common.test.ts`; expected 22 passing cases.
- [ ] **Step 5: Write `errors.test.ts` first** with all 10 codes/statuses, always-present details, and strict nested details.
- [ ] **Step 6: Run errors red:** `scripts/run-node24 pnpm --filter @opspulse/contracts test -- errors.test.ts`; expected missing `errors.ts`.
- [ ] **Step 7: Implement errors.**
- [ ] **Step 8: Run errors green:** same focused command; expected 10 mapping cases plus shape cases pass.
- [ ] **Step 9: Write `failure-causes.test.ts`** for all categories, exact code/status/null rules, HTTP status 99/100/599/600, safe-summary empty/max/overflow, and at least 20 cases.
- [ ] **Step 10: Run causes red:** `scripts/run-node24 pnpm --filter @opspulse/contracts test -- failure-causes.test.ts`; expected missing module.
- [ ] **Step 11: Implement causes.**
- [ ] **Step 12: Run causes green:** same focused command; expected at least 16 passing cases.
- [ ] **Step 13: Write `incident-summary.test.ts`** for exact open literal, resolved-status rejection, fields, nested cause, and unknown rejection.
- [ ] **Step 14: Run summary red:** `scripts/run-node24 pnpm --filter @opspulse/contracts test -- incident-summary.test.ts`; expected missing module.
- [ ] **Step 15: Implement summary.**
- [ ] **Step 16: Run summary green:** same focused command; expected all summary cases pass.
- [ ] **Step 17: Write `sessions.test.ts`** for exact keys/nulls, email/password/token/client limits, normalization, leakage, and unknown fields.
- [ ] **Step 18: Run sessions red:** `scripts/run-node24 pnpm --filter @opspulse/contracts test -- sessions.test.ts`; expected missing module.
- [ ] **Step 19: Implement sessions.**
- [ ] **Step 20: Run sessions green:** same focused command; expected all session cases pass.
- [ ] **Step 21: Write `health.test.ts`** for both services, ready/not-ready refinements, duplicate/missing dependencies, and exact branches.
- [ ] **Step 22: Run health red:** `scripts/run-node24 pnpm --filter @opspulse/contracts test -- health.test.ts`; expected missing module.
- [ ] **Step 23: Implement health.**
- [ ] **Step 24: Run health green:** same focused command; expected all health branch cases pass.
- [ ] **Step 25: Export this task's contract symbols explicitly** from `packages/contracts/src/index.ts`, retaining the scaffold `MonitorKind` until Task 2 replaces it.
- [ ] **Step 26: Run both package suites independently:** `scripts/run-node24 pnpm --filter @opspulse/contracts test` then `scripts/run-node24 pnpm --filter @opspulse/domain test`; both exit 0.
- [ ] **Step 27: Commit:** `git add packages/contracts/package.json packages/contracts/src/index.ts packages/contracts/src/{zod,common,errors,failure-causes,incident-summary,sessions,health}* pnpm-lock.yaml && git commit -m "feat(contracts): add API primitives"`.

### Task 2: Monitor Contracts And Secret-Safe Headers

**Files:** `packages/contracts/src/monitors.ts`, `packages/contracts/src/monitors.test.ts`.

- [ ] **Step 1: Write defaults/ranges tests** for each create default and min/max/just-outside interval, grace, thresholds, timeout, status, name, URL, and 20/21 headers.
- [ ] **Step 2: Run red:** `scripts/run-node24 pnpm --filter @opspulse/contracts test -- monitors.test.ts`; expected missing module.
- [ ] **Step 3: Implement create schemas only.**
- [ ] **Step 4: Run create green:** `scripts/run-node24 pnpm --filter @opspulse/contracts test -- monitors.test.ts`; expected default/range group passes.
- [ ] **Step 5: Add failing header-security tests** for case-insensitive duplicates, each forbidden name pattern, credential/JWT/AWS value patterns, allowed ordinary headers, and exact preservation.
- [ ] **Step 6: Run header red:** same focused command; expected new header-security cases fail.
- [ ] **Step 7: Implement header refinements.**
- [ ] **Step 8: Run header green:** same command; expected all header cases pass.
- [ ] **Step 9: Add failing update/private/envelope tests** covering no defaults, non-empty updates, immutable rejection, exact sequence fields/nullability, one-time heartbeat token, and response key sets.
- [ ] **Step 10: Run update red:** same focused command; expected new update/projection cases fail.
- [ ] **Step 11: Implement remaining schemas.**
- [ ] **Step 12: Run monitor green:** `scripts/run-node24 pnpm --filter @opspulse/contracts test -- monitors.test.ts`; expected at least 45 named cases pass.
- [ ] **Step 13: Replace the scaffold `MonitorKind` declaration** with explicit monitor module exports in `packages/contracts/src/index.ts`.
- [ ] **Step 14: Run suites independently:** `scripts/run-node24 pnpm --filter @opspulse/contracts test`, then separately `scripts/run-node24 pnpm --filter @opspulse/domain test`; both exit 0.
- [ ] **Step 15: Commit:** `git add packages/contracts/src/index.ts packages/contracts/src/monitors* && git commit -m "feat(contracts): define monitor contracts"`.

### Task 3: Check, Heartbeat, Incident, And Timeline Contracts

**Files:** `checks.ts/test`, `heartbeats.ts/test`, `incidents.ts/test`, `incident-events.ts/test`.

- [ ] **Step 1: Write `checks.test.ts`** for exact sequence/version/nullability, pending-null versus terminal-non-null status refinement, terminal-before-created rejection, HTTP status 99/100/599/600, safe monitoring errors, and three history branches.
- [ ] **Step 2: Run checks red:** `scripts/run-node24 pnpm --filter @opspulse/contracts test -- checks.test.ts`; expected missing module.
- [ ] **Step 3: Implement checks.**
- [ ] **Step 4: Run checks green:** same command; expected all result/cause/history/query cases pass.
- [ ] **Step 5: Write `heartbeats.test.ts`** for token 42/43/128/129, exact lowercase header key, idempotency 0/1/255/256, and response keys.
- [ ] **Step 6: Run heartbeats red:** `scripts/run-node24 pnpm --filter @opspulse/contracts test -- heartbeats.test.ts`; expected missing module.
- [ ] **Step 7: Implement heartbeats.**
- [ ] **Step 8: Run heartbeats green:** `scripts/run-node24 pnpm --filter @opspulse/contracts test -- heartbeats.test.ts`; expected 12 boundary/shape cases pass.
- [ ] **Step 9: Write `incidents.test.ts`** for open/resolved timestamp/reason branches, imported cause/summary ownership, filters, and list envelope.
- [ ] **Step 10: Run incidents red:** `scripts/run-node24 pnpm --filter @opspulse/contracts test -- incidents.test.ts`; expected missing module.
- [ ] **Step 11: Implement incidents.**
- [ ] **Step 12: Run incidents green:** `scripts/run-node24 pnpm --filter @opspulse/contracts test -- incidents.test.ts`; expected all incident cases pass.
- [ ] **Step 13: Write `incident-events.test.ts`** for all five exact discriminants/details and cross-type detail rejection.
- [ ] **Step 14: Run events red:** `scripts/run-node24 pnpm --filter @opspulse/contracts test -- incident-events.test.ts`; expected missing module.
- [ ] **Step 15: Implement timeline schemas.**
- [ ] **Step 16: Run events green:** same focused command; expected five valid plus at least ten mismatched/unknown cases pass.
- [ ] **Step 17: Export this task's contract symbols explicitly** from `packages/contracts/src/index.ts`.
- [ ] **Step 18: Run suites independently:** `scripts/run-node24 pnpm --filter @opspulse/contracts test`, then separately `scripts/run-node24 pnpm --filter @opspulse/domain test`; both exit 0.
- [ ] **Step 19: Commit:** `git add packages/contracts/src/index.ts packages/contracts/src/{checks,heartbeats,incidents,incident-events}* && git commit -m "feat(contracts): define reliability history"`.

### Task 4: Split Notification Contracts

**Files:** `notification-channels.ts/test`, `notification-deliveries.ts/test`, `webhook.ts/test`, `incident-detail.ts/test`.

- [ ] **Step 1: Write channel tests** for name 0/1/100/101, URL schemes/length/userinfo, secret 31/32/1024/1025, enabled default, non-empty update, lifecycle filter, response key allowlist, and unknown rejection.
- [ ] **Step 2: Run channels red:** `scripts/run-node24 pnpm --filter @opspulse/contracts test -- notification-channels.test.ts`; expected missing module.
- [ ] **Step 3: Implement channels.**
- [ ] **Step 4: Run channels green:** same focused command; expected all boundary/default/allowlist cases pass.
- [ ] **Step 5: Write delivery tests** for each status branch, retry field combinations, response status 99/100/599/600, safe-error boundaries, embedded immutable attempt ownership/order/uniqueness/count, 0/6/7 attempt bounds, list page 1/25/100/101, incident-detail reuse, filters, and replay literal.
- [ ] **Step 6: Run deliveries red:** `scripts/run-node24 pnpm --filter @opspulse/contracts test -- notification-deliveries.test.ts`; expected missing module.
- [ ] **Step 7: Implement deliveries.**
- [ ] **Step 8: Run deliveries green:** same focused command; expected all branch cross-product cases pass.
- [ ] **Step 9: Write webhook schema tests** for opened/recovered/archived exact keys/nulls, unknown private keys, headers, and safe monitor states.
- [ ] **Step 10: Run webhook red:** `scripts/run-node24 pnpm --filter @opspulse/contracts test -- webhook.test.ts`; expected missing module.
- [ ] **Step 11: Implement webhook contracts.**
- [ ] **Step 12: Run webhook green:** same focused command; expected all webhook branch cases pass.
- [ ] **Step 13: Write `incident-detail.test.ts`** for the exact composed envelope after incident/event/delivery owners exist.
- [ ] **Step 14: Run detail red:** `scripts/run-node24 pnpm --filter @opspulse/contracts test -- incident-detail.test.ts`; expected missing module.
- [ ] **Step 15: Implement detail.**
- [ ] **Step 16: Run detail green:** same focused command; expected exact-envelope cases pass.
- [ ] **Step 17: Export this task's contract symbols explicitly** from `packages/contracts/src/index.ts`.
- [ ] **Step 18: Run suites independently:** `scripts/run-node24 pnpm --filter @opspulse/contracts test`, then separately `scripts/run-node24 pnpm --filter @opspulse/domain test`; both exit 0.
- [ ] **Step 19: Commit:** `git add packages/contracts/src/index.ts packages/contracts/src/notification-* packages/contracts/src/webhook* packages/contracts/src/incident-detail* && git commit -m "feat(contracts): define notification contracts"`.

### Task 5: Dashboard And Public Status Contracts

**Files:** `dashboard.ts/test`, `public-status.ts/test`.

- [ ] **Step 1: Write dashboard tests** for exact envelope/keys, every count, one row per role, freshness null pairs, 60/61 seconds, and monitoring availability.
- [ ] **Step 2: Run dashboard red:** `scripts/run-node24 pnpm --filter @opspulse/contracts test -- dashboard.test.ts`; expected missing module.
- [ ] **Step 3: Implement dashboard.**
- [ ] **Step 4: Run dashboard green:** same focused command; expected all dashboard cases pass.
- [ ] **Step 5: Write public tests** for exact allowlisted keys, open/null and resolved/non-null incident refinement, resolved active-incident rejection, resolved-before-started rejection, states, fixed literal 90, envelopes, and unknown/private field rejection.
- [ ] **Step 6: Run public red:** `scripts/run-node24 pnpm --filter @opspulse/contracts test -- public-status.test.ts`; expected missing module.
- [ ] **Step 7: Implement public schemas without importing private monitor/channel/delivery schemas.**
- [ ] **Step 8: Run public green:** same focused command; expected all public schema cases pass.
- [ ] **Step 9: Export dashboard/public contract symbols explicitly** from `packages/contracts/src/index.ts`.
- [ ] **Step 10: Run suites independently:** `scripts/run-node24 pnpm --filter @opspulse/contracts test`, then separately `scripts/run-node24 pnpm --filter @opspulse/domain test`; both exit 0.
- [ ] **Step 11: Commit:** `git add packages/contracts/src/index.ts packages/contracts/src/{dashboard,public-status}* && git commit -m "feat(contracts): define operational projections"`.

### Task 6: Focused OpenAPI Composition

**Files:** every listed `packages/contracts/src/openapi/*` file. Each registrar test asserts only its matrix rows, request locations, security, success statuses, and exact error code/status pairs.

- [ ] **Step 1: Write sessions registrar tests**, including combined CSRF security and 204 without `content` or `requestBody`.
- [ ] **Step 2: Run sessions OpenAPI red:** `scripts/run-node24 pnpm --filter @opspulse/contracts test -- openapi/sessions.test.ts`; expected missing registrar.
- [ ] **Step 3: Implement sessions registrar.**
- [ ] **Step 4: Run sessions green:** same focused command.
- [ ] **Step 5: Write health registrar tests** for public security, 200 ready, distinct 503 not-ready, and 500 error envelope; assert the generic ApiError registrar rule exempts only readiness 503 and that 503 contains exactly `NotReadyResponseSchema` with no ApiError ref.
- [ ] **Step 6: Run health red:** `scripts/run-node24 pnpm --filter @opspulse/contracts test -- openapi/health.test.ts`; expected missing registrar.
- [ ] **Step 7: Implement health registrar.**
- [ ] **Step 8: Run health green:** same focused command.
- [ ] **Step 9: Write monitors registrar tests** for all monitor/check paths, path 400s, query/body schemas, no-body commands, and mutation security.
- [ ] **Step 10: Run monitors red:** `scripts/run-node24 pnpm --filter @opspulse/contracts test -- openapi/monitors.test.ts`; expected missing registrar.
- [ ] **Step 11: Implement monitors registrar.**
- [ ] **Step 12: Run monitors green:** same focused command.
- [ ] **Step 13: Write heartbeat registrar tests** for token path, optional `Idempotency-Key`, no request body/session/CSRF, 202, 400/404/429/500.
- [ ] **Step 14: Run heartbeat red:** `scripts/run-node24 pnpm --filter @opspulse/contracts test -- openapi/heartbeats.test.ts`; expected missing registrar.
- [ ] **Step 15: Implement heartbeat registrar.**
- [ ] **Step 16: Run heartbeat green:** same focused command.
- [ ] **Step 17: Write incident registrar tests.**
- [ ] **Step 18: Run incidents red:** `scripts/run-node24 pnpm --filter @opspulse/contracts test -- openapi/incidents.test.ts`; expected missing registrar.
- [ ] **Step 19: Implement incident registrar.**
- [ ] **Step 20: Run incidents green:** same focused command.
- [ ] **Step 21: Write channel registrar tests.**
- [ ] **Step 22: Run channels red:** `scripts/run-node24 pnpm --filter @opspulse/contracts test -- openapi/channels.test.ts`; expected missing registrar.
- [ ] **Step 23: Implement channel registrar.**
- [ ] **Step 24: Run channels green:** same focused command.
- [ ] **Step 25: Write delivery registrar tests** for only the approved list and replay operations. Assert list items reference `NotificationDeliverySchema` with embedded attempts and that no `GET /v1/deliveries/{deliveryId}` path exists.
- [ ] **Step 26: Run deliveries red:** `scripts/run-node24 pnpm --filter @opspulse/contracts test -- openapi/deliveries.test.ts`; expected missing registrar.
- [ ] **Step 27: Implement delivery registrar.**
- [ ] **Step 28: Run deliveries green:** same focused command.
- [ ] **Step 29: Write dashboard registrar tests.**
- [ ] **Step 30: Run dashboard red:** `scripts/run-node24 pnpm --filter @opspulse/contracts test -- openapi/dashboard.test.ts`; expected missing registrar.
- [ ] **Step 31: Implement dashboard registrar.**
- [ ] **Step 32: Run dashboard green:** same focused command.
- [ ] **Step 33: Write public-status registrar tests** plus the reachable-component allowlist. Require the component set to be a subset of exactly `PublicStatusResponse`, `PublicMonitorResponse`, `PublicStatus`, `PublicMonitor`, `PublicIncident`, `PublicActiveIncident`, `PublicMonitorState`, `PublicAggregateState`, `IncidentStatus`, `Id`, `Timestamp`, `PublicMonitorSlug`, `SafeMessage`, `ApiError`, `ApiErrorCode`, `ApiErrorDetail`, and `CorrelationId`; assert exact object keys.
- [ ] **Step 34: Run public OpenAPI red:** `scripts/run-node24 pnpm --filter @opspulse/contracts test -- openapi/public-status.test.ts`; expected missing registrar/ref walker.
- [ ] **Step 35: Implement public registrar/ref walking.** Do not substitute a denied-property scan.
- [ ] **Step 36: Run public OpenAPI green:** same focused command.
- [ ] **Step 37: Write document composition tests** for exact operation set, unique operation IDs, all refs resolved, deterministic ordering, and no unowned route.
- [ ] **Step 38: Run document red:** `scripts/run-node24 pnpm --filter @opspulse/contracts test -- openapi/document.test.ts`; expected missing composer.
- [ ] **Step 39: Implement composition.**
- [ ] **Step 40: Generate and inspect snapshot:** run `scripts/run-node24 pnpm --filter @opspulse/contracts test -- openapi/document.test.ts -u`, inspect the snapshot, then rerun without `-u`; expected one stable snapshot.
- [ ] **Step 41: Export `createOpenApiDocument` and `OpenApiDocument` explicitly** from `packages/contracts/src/index.ts`.
- [ ] **Step 42: Run suites independently:** `scripts/run-node24 pnpm --filter @opspulse/contracts test`, `scripts/run-node24 pnpm --filter @opspulse/domain test`, `scripts/run-node24 pnpm --filter @opspulse/contracts typecheck`, and `scripts/run-node24 pnpm --filter @opspulse/contracts build`; all exit 0.
- [ ] **Step 43: Commit:** `git add packages/contracts/src/index.ts packages/contracts/src/openapi && git commit -m "feat(contracts): publish OpenAPI document"`.

## Chunk 2: Pure Reliability Domain

### Task 7: Preserve Monitor-Kind Compatibility

**Files:** create `monitor-kind.ts/test`; modify `index.ts`; delete placeholder domain `index.test.ts` after green.

- [ ] **Step 1: Move the existing three-case test** (`http`, `heartbeat`, `smtp`) adjacent to `monitor-kind.ts` and initially import the missing focused module.
- [ ] **Step 2: Run red:** `scripts/run-node24 pnpm --filter @opspulse/domain test -- monitor-kind.test.ts`; expected missing focused module.
- [ ] **Step 3: Implement `isMonitorKind` in the focused module.**
- [ ] **Step 4: Re-export it from the existing index, switch the test to the index import, and delete the old index test.**
- [ ] **Step 5: Run domain green:** same focused command; expected three cases pass.
- [ ] **Step 6: Run database scaffold independently:** `scripts/run-node24 pnpm --filter @opspulse/database test`; expected existing stored-monitor test passes unchanged.
- [ ] **Step 7: Commit:** `git add packages/domain/src/index.ts packages/domain/src/index.test.ts packages/domain/src/monitor-kind* && git commit -m "refactor(domain): preserve monitor kind boundary"`.

### Task 8: Ordered State And Per-Channel Effects

**Files:** `monitor-state.ts`, `monitor-state.test.ts`.

- [ ] **Step 1: Write ordering tests red** for old/future generation on active/paused/archived snapshots, consumed sequence, one/many gaps waiting without mutation, current-generation non-active rejection, contiguous result, and cancelled-internal exact effect. Assert generation mismatch is classified before lifecycle/context validation.
- [ ] **Step 2: Run ordering red:** `scripts/run-node24 pnpm --filter @opspulse/domain test -- monitor-state.test.ts`; expected missing module.
- [ ] **Step 3: Implement ordering only.**
- [ ] **Step 4: Run ordering green:** same focused command; ordering group passes.
- [ ] **Step 5: Add full state matrix failing tests:** pending with/without retained incident, up, degraded with/without incident, down, both threshold edges, counter resets, all material-cause variants, required/forbidden proposed incident IDs, below-threshold unused proposal, and exact proposed ID propagation into snapshot/effects.
- [ ] **Step 6: Run matrix red:** same focused command; expected new transition cases fail.
- [ ] **Step 7: Implement state/cause behavior.**
- [ ] **Step 8: Run matrix green:** same focused command; all state/cause cases pass.
- [ ] **Step 9: Add failing exact-effect-order tests** for zero, one, and two unsorted/duplicate channels on opening, recovery, observe, cancelled, and no-transition paths. Assert indices reference actual timeline/delivery positions and channels are unique/sorted.
- [ ] **Step 10: Run effects red:** same focused command; expected new effect arrays fail.
- [ ] **Step 11: Implement per-channel delivery, notification-queued timeline, and outbox effects.**
- [ ] **Step 12: Run state green:** same command; expected at least 40 parameterized transitions plus ordering/effect cases pass.
- [ ] **Step 13: Run suites independently:** `scripts/run-node24 pnpm --filter @opspulse/contracts test`, then separately `scripts/run-node24 pnpm --filter @opspulse/domain test`; both exit 0.
- [ ] **Step 14: Commit:** `git add packages/domain/src/monitor-state* && git commit -m "feat(domain): evaluate ordered monitor results"`.

### Task 9: Lifecycle And Archive Effects

**Files:** `monitor-lifecycle.ts`, `monitor-lifecycle.test.ts`.

- [ ] **Step 1: Write pause/resume tests red** for exact snapshot/effects and retained incident.
- [ ] **Step 2: Run lifecycle red:** `scripts/run-node24 pnpm --filter @opspulse/domain test -- monitor-lifecycle.test.ts`; expected missing module.
- [ ] **Step 3: Implement pause/resume.**
- [ ] **Step 4: Run pause/resume green:** same focused command.
- [ ] **Step 5: Add archive tests red** for active/paused, no incident, incident with zero/one/two channels, exact cancel-before-resolution ordering, and invalid lifecycle combinations.
- [ ] **Step 6: Run archive red:** same focused command; expected new archive cases fail.
- [ ] **Step 7: Implement archive.**
- [ ] **Step 8: Run lifecycle green:** same focused command; expected all lifecycle/effect cases pass.
- [ ] **Step 9: Run suites independently:** `scripts/run-node24 pnpm --filter @opspulse/contracts test`, then separately `scripts/run-node24 pnpm --filter @opspulse/domain test`; both exit 0.
- [ ] **Step 10: Commit:** `git add packages/domain/src/monitor-lifecycle* && git commit -m "feat(domain): define lifecycle transitions"`.

### Task 10: SHA-256 And Deterministic Identifiers

**Files:** `sha256.ts/test`, `identifiers.ts/test`, `scripts/generate-identifier-vectors.mjs`.

`sha256.ts` uses only ES2023 primitives and rejects malformed UTF-16 rather than replacing it. `identifiers.ts` exports `CanonicalUtcTimestamp`, `HeartbeatPingIdentity`, `OutboxIdInput`, and these exact signatures:

```ts
type HeartbeatPingIdentity =
  | {kind:"idempotency-key"; key:string}
  | {kind:"generated-nonce"; nonce:Id};
type OutboxIdInput =
  | {eventType:"check.requested"; monitorId:Id; checkRequestId:Id}
  | {eventType:"notification.requested"; deliveryId:Id}
  | {eventType:"maintenance.requested"; aggregateId:Id; maintenanceKind:"retention"|"request_reaper"; scheduledAt:CanonicalUtcTimestamp};
function createHttpCheckRequestId(input:{monitorId:Id; generation:number; sequence:number}):Id;
function createHttpCheckRunId(input:{checkRequestId:Id}):Id;
function createMissedHeartbeatCheckRequestId(input:{monitorId:Id; generation:number; deadline:CanonicalUtcTimestamp}):Id;
function createMissedHeartbeatCheckRunId(input:{checkRequestId:Id}):Id;
function createHeartbeatPingCheckRequestId(input:{monitorId:Id; identity:HeartbeatPingIdentity}):Id;
function createHeartbeatPingCheckRunId(input:{monitorId:Id; identity:HeartbeatPingIdentity}):Id;
function createIncidentId(input:{monitorId:Id; generation:number; openingCheckId:Id}):Id;
function createOutboxEventId(input:OutboxIdInput):Id;
function createNotificationDeliveryId(input:{incidentEventId:Id; channelId:Id; payloadVersion:"opspulse.webhook.v1"}):Id;
function createNotificationDeduplicationKey(input:{incidentEventId:Id; channelId:Id; payloadVersion:"opspulse.webhook.v1"}):string;
function createReplayDeliveryId(input:{originalDeliveryId:Id; replayNumber:number}):Id;
function createReplayDeduplicationKey(input:{originalKey:string; replayNumber:number}):string;
```

Identity ownership is exact:

- HTTP schedule: CheckRequest uses `createHttpCheckRequestId`; its CheckRun uses separate `createHttpCheckRunId(requestId)`. The UUIDs never reuse one another.
- Missed-heartbeat deadline: CheckRequest is keyed by monitor/generation/deadline; its CheckRun uses separate `createMissedHeartbeatCheckRunId(requestId)`. The UUIDs never reuse one another.
- Direct heartbeat: request and run use separate functions/kind tags over the same monitor/execution identity. With an idempotency key, trim/validate 1..255 and retries reproduce both IDs; without one, generate one UUID nonce for that HTTP request and reuse it for transaction retries, while a network retry receives a new nonce as documented. The API's returned `checkId` is the CheckRun ID.

These values are persisted as `CheckRequest.id` and `CheckRun.id`; every run's `checkRequestId` references its corresponding distinct request UUID. A persistence retry after PostgreSQL failure recomputes the same pair, and uniqueness conflicts are successful no-ops. Direct heartbeat creates its separately identified request/run together in one transaction. This preserves stable CheckRun IDs and deterministic retry persistence.

Canonical preimage encoding is normative. Let `utf8(s)` be standard shortest-form UTF-8 with no Unicode normalization or escaping; reject unpaired UTF-16 surrogates. Let `frame(s) = uint32be(byteLength(utf8(s))) || utf8(s)`. Let `US = 0x1f` and `RS = 0x1e`. Encode exactly `frame("opspulse:id:v1") || US || frame(kindTag) || Σ(RS || frame(fieldName) || US || frame(canonicalValue))` in signature field order, with no leading/trailing bytes. Lengths cover only the immediately following UTF-8 bytes, never separators. Prefix, kind, every field name, and every field value are framed. Integers are unsigned canonical base-10 with no sign/leading zero. UUIDs are validated/lowercase-normalized. Timestamps are exact valid UTC `YYYY-MM-DDTHH:mm:ss.sssZ`.

Literal kind tags are `http-check-request`, `http-check-run`, `heartbeat-deadline-request`, `heartbeat-deadline-run`, `heartbeat-ping-request`, `heartbeat-ping-run`, `incident`, `outbox-check-requested`, `outbox-notification-requested`, `outbox-maintenance-requested`, `notification-delivery`, and `replay-delivery`. Heartbeat identity fields are `identityKind` then `identityValue`; non-ASCII values contribute raw UTF-8 bytes, not JSON escapes.

Hash the preimage with SHA-256, take bytes 0..15, set byte 6 high nibble to UUID version 8 and byte 8 high bits to RFC 4122 variant `10`, then format lowercase `8-4-4-4-12` hex. This rule applies to every UUID function.

Outbox aggregate/discriminators are exact: check aggregate is `monitorId` and discriminator is `checkRequestId`; notification aggregate and discriminator are `deliveryId`; maintenance aggregate is `aggregateId` and discriminator fields are `maintenanceKind`, then `scheduledAt`. Notification dedupe output is `notification:v1:<incidentEventId>:<channelId>:opspulse.webhook.v1`. Replay dedupe output is `<originalKey>:replay:<replayNumber>` with replay number >=1. No raw idempotency key appears in any returned value/error.

- [ ] **Step 1: Write SHA tests red** for NIST empty/abc/56-byte/multi-block vectors, a valid non-ASCII vector, block boundaries, and lone high surrogate `\uD800`, lone low surrogate `\uDC00`, and reversed surrogate pair rejection (at least 10 cases).
- [ ] **Step 2: Run SHA red:** `scripts/run-node24 pnpm --filter @opspulse/domain test -- sha256.test.ts`; expected missing module.
- [ ] **Step 3: Implement UTF-8/SHA-256.**
- [ ] **Step 4: Run SHA green:** same focused command; all vectors pass and malformed Unicode throws.
- [ ] **Step 5: Write ID validation tests.** Cover every signature; request/run IDs parse `IdSchema`; generation is >=0; sequence/replay >=1; heartbeat key trim/Unicode; canonical timestamps; outbox discriminants; exact key strings.
- [ ] **Step 6: Add collision/idempotency tests.** Same retry yields the same request/run pair; request and run differ; HTTP/deadline/ping namespaces differ; generation/sequence/deadline/key/nonce changes differ; idempotent ping retries match while generated nonces differ.
- [ ] **Step 7: Create the independent vector generator.** It uses only `node:crypto`, duplicates the normative framing independently, and never imports production code.
- [ ] **Step 8: Generate vectors:** `scripts/run-node24 node scripts/generate-identifier-vectors.mjs`; use fixed UUID inputs, generation 7, sequence 42, `2026-07-21T12:34:56.789Z`, key `job/é/42`, and a fixed nonce.
- [ ] **Step 9: Paste fixed literals into tests** for all 12 UUID kind tags and both exact dedupe-key outputs. Tests compare production output to literals and never invoke the generator.
- [ ] **Step 10: Run IDs red:** `scripts/run-node24 pnpm --filter @opspulse/domain test -- identifiers.test.ts`; expected missing module.
- [ ] **Step 11: Implement the normative framing, UUID, and key rules.**
- [ ] **Step 12: Run IDs green:** same focused command; all validation, collision, idempotency, and fixed-vector cases pass.
- [ ] **Step 13: Run suites independently:** `scripts/run-node24 pnpm --filter @opspulse/contracts test`, then separately `scripts/run-node24 pnpm --filter @opspulse/domain test`; both exit 0.
- [ ] **Step 14: Commit:** `git add packages/domain/src/{sha256,identifiers}* scripts/generate-identifier-vectors.mjs && git commit -m "feat(domain): add deterministic identifiers"`.

### Task 11: Safe Webhook Builder And Public Projection

**Files:** `webhook-payload.ts/test`, `public-status.ts/test`.

`webhook-payload.ts` exports `OpenedWebhookPayloadInput`, `ResolvedWebhookPayloadInput`, `WebhookPayloadInput`, and `buildWebhookPayload`. Inputs are exact:

```ts
type OpenedWebhookPayloadInput = {
  eventId:Id; eventType:"incident.opened"; occurredAt:Timestamp;
  monitor:{slug:PublicMonitorSlug; name:string; state:"down"};
  incident:{id:Id; startedAt:Timestamp}; message:string; cause:FailureCause;
};
type ResolvedWebhookPayloadInput = {
  eventId:Id; eventType:"incident.resolved"; occurredAt:Timestamp;
  monitor:{slug:PublicMonitorSlug; name:string; state:MonitorState};
  incident:{id:Id; startedAt:Timestamp; resolvedAt:Timestamp}; message:string;
  resolution:"recovered"|"monitor_archived";
};
```

The builder adds version and contract-required null fields, accepts only those unions, and never accepts/spreads `PrivateMonitor`. `public-status.ts` exports these exact inputs plus `PublicIncidentProjectionInput`, `projectPublicStatus`, and `projectPublicMonitor`:

```ts
type PublicMonitorProjectionInput = {
  slug:PublicMonitorSlug; name:string; state:MonitorState; lifecycle:"active"|"paused"|"archived";
  published:boolean; updatedAt:Timestamp; activeIncident:PublicActiveIncident|null;
};
type WorkerHeartbeatProjectionInput = {role:"scheduler"|"checker"; lastSeenAt:Timestamp};
type PublicIncidentProjectionInput = {monitorSlug:PublicMonitorSlug; incident:PublicIncident};
type PublicStatusProjectionInput = {
  now:Timestamp; monitors:readonly PublicMonitorProjectionInput[];
  incidents:readonly PublicIncidentProjectionInput[]; workerHeartbeats:readonly WorkerHeartbeatProjectionInput[];
};
```

Signatures are `buildWebhookPayload(input): OpsPulseWebhookV1`, `projectPublicStatus(input): PublicStatus`, and `projectPublicMonitor(input, incidents): PublicMonitorResponse["data"] | null` (`null` for unpublished/archived input). `projectPublicStatus` first builds `retainedSlugs` from monitors where `published === true && lifecycle !== "archived"`; it then filters projection incidents by both `retainedSlugs.has(monitorSlug)` and the 90-day cutoff, and only after filtering maps each association to its nested public `incident`. `projectPublicMonitor` first rejects unpublished/archived input, then filters by equal `monitorSlug` and cutoff before stripping. Neither output includes `monitorSlug` or any internal monitor ID.

- [ ] **Step 1: Write webhook builder tests red** for opened/recovered/archived exact deep equality, schema parse, compile-time non-acceptance of private monitor, and exact output key sets.
- [ ] **Step 2: Run webhook builder red:** `scripts/run-node24 pnpm --filter @opspulse/domain test -- webhook-payload.test.ts`; expected missing module.
- [ ] **Step 3: Implement field-by-field builder.**
- [ ] **Step 4: Run webhook builder green:** same focused command; all builder cases pass.
- [ ] **Step 5: Write public projection tests.** Inputs are projection-only monitor associations plus safe incident values and worker heartbeat times. Include one retained published monitor, one unpublished monitor, and one archived published monitor, each with an in-window incident; assert only the retained monitor's incident survives overall projection, unpublished/archived incidents are absent, per-monitor filtering agrees, and association fields are stripped. Also test state mapping, paused maintenance retention, maintenance aggregate exclusion, worst-state order, no monitors, 60/61 freshness, missing role override, multiple instances with any fresh instance winning, fixed 90-day inclusive cutoff, old incident exclusion, newest-first deterministic incident sorting, slug-ascending monitor sorting, and exact contract parse.
- [ ] **Step 6: Run projection red:** `scripts/run-node24 pnpm --filter @opspulse/domain test -- public-status.test.ts`; expected missing module.
- [ ] **Step 7: Implement pure projection without Node/DOM globals.** Compute retained monitor slugs before incident filtering/association stripping exactly as specified above. Active published monitors appear; paused published monitors appear as maintenance; archived/unpublished do not. If no scheduler or checker instance is fresh, set `monitoringAvailable=false` and aggregate unknown even when targets are up. With monitoring available but no active non-maintenance published monitor (including an empty or maintenance-only list), aggregate is unknown. Sort monitors by slug code-unit order and incidents by `(startedAt,id)` newest-first. Use epoch arithmetic from validated timestamps and `90 * 24 * 60 * 60 * 1000`.
- [ ] **Step 8: Run projection green:** same focused command; expected at least 18 projection cases pass.
- [ ] **Step 9: Run suites independently:** `scripts/run-node24 pnpm --filter @opspulse/contracts test`, then separately `scripts/run-node24 pnpm --filter @opspulse/domain test`; both exit 0.
- [ ] **Step 10: Commit:** `git add packages/domain/src/{webhook-payload,public-status}* && git commit -m "feat(domain): build safe external projections"`.

## Chunk 3: Public Surfaces And Regression

### Task 12: Explicit Package Exports And Full Verification

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Delete: `packages/contracts/src/index.test.ts`
- Modify: `packages/contracts/src/openapi/document.test.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/domain/src/monitor-state.test.ts`
- Modify: `packages/domain/src/monitor-lifecycle.test.ts`
- Modify: `packages/domain/src/sha256.test.ts`
- Modify: `packages/domain/src/identifiers.test.ts`
- Modify: `packages/domain/src/webhook-payload.test.ts`
- Modify: `packages/domain/src/public-status.test.ts`

- [ ] **Step 1: Make the enumerated consumer tests import public entries.** `openapi/document.test.ts` imports `createOpenApiDocument` and `OpenApiDocument` from `../index.js`; the six listed domain tests import their public values/types from `./index.js`. `monitor-kind.test.ts` is not changed here because Task 7 already switched it to the public index.
- [ ] **Step 2: Audit the incrementally built contract index** against every schema, type, constant, embedded-attempt symbol, and OpenAPI symbol named in this plan; add only omissions and keep explicit exports without `export *`.
- [ ] **Step 3: Replace the remaining domain index surface with explicit exports** for all state/effect/lifecycle symbols, SHA/ID APIs, webhook builder, and public projection APIs while preserving Task 7's `isMonitorKind` export. Delete only the contracts scaffold index test here after OpenAPI coverage replaces it.
- [ ] **Step 4: Run each suite independently:**

```bash
scripts/run-node24 pnpm --filter @opspulse/contracts test
scripts/run-node24 pnpm --filter @opspulse/domain test
scripts/run-node24 pnpm --filter @opspulse/database test
scripts/run-node24 pnpm --filter @opspulse/contracts typecheck
scripts/run-node24 pnpm --filter @opspulse/domain typecheck
scripts/run-node24 pnpm --filter @opspulse/contracts build
scripts/run-node24 pnpm --filter @opspulse/domain build
```

Expected: all seven commands exit 0; database still resolves `isMonitorKind`.

- [ ] **Step 5: Verify semantic/global lint under the wrapper:** `scripts/run-node24 pnpm lint`; expected exit 0 with no undefined Node/DOM production globals. ES2023-only package builds remain authoritative.
- [ ] **Step 6: Run frozen clean workspace regression:** `scripts/run-node24 pnpm install --frozen-lockfile`, `scripts/run-node24 pnpm clean`, then `scripts/run-node24 pnpm check`; expected build, lint, typechecks, and all unit tests pass.
- [ ] **Step 7: Inspect pre-commit scope:** `git status --short && git diff --stat`; expected changed-file set is exactly the 10 paths in this task's Files section: contracts index, deleted contracts index test, OpenAPI document test, domain index, and six domain consumer tests. The separately committed plan/wrapper and `monitor-kind.test.ts` must not appear.
- [ ] **Step 8: Stage and commit every Task 12 change:**

```bash
git add \
  packages/contracts/src/index.ts \
  packages/contracts/src/index.test.ts \
  packages/contracts/src/openapi/document.test.ts \
  packages/domain/src/index.ts \
  packages/domain/src/monitor-state.test.ts \
  packages/domain/src/monitor-lifecycle.test.ts \
  packages/domain/src/sha256.test.ts \
  packages/domain/src/identifiers.test.ts \
  packages/domain/src/webhook-payload.test.ts \
  packages/domain/src/public-status.test.ts
git diff --cached --name-status
git commit -m "feat: publish contracts and domain APIs"
```

Expected staged set matches the Files section exactly, including `D packages/contracts/src/index.test.ts`.
- [ ] **Step 9: Verify final status:** `git status --short`; expected no output.

## Final Requirement Audit

- [ ] `isMonitorKind` remains exported and the unchanged database scaffold test passes.
- [ ] Every contract task exports its symbols before running domain/workspace builds.
- [ ] Proposed deterministic incident IDs flow into opening snapshot/effects without persistence-time circularity.
- [ ] Old-generation work is ignored before lifecycle checks; only current-generation next-sequence consumption requires active lifecycle.
- [ ] Pending-with-retained-incident success/failure semantics prevent leaked incidents and duplicate opening.
- [ ] Every opening/resolution/archive has exact incident, timeline, per-channel delivery, notification-queued, and outbox ordering.
- [ ] Sequence gaps wait; cancelled-internal advances only ordering and records a monitoring error.
- [ ] Every major schema has exact fields, enums, nullability, nested strictness, and response envelope.
- [ ] Check/public-incident/active-incident/status-time, HTTP-status, and safe-error refinements have boundary tests.
- [ ] OpenAPI has exact request locations, security, path 400s, error codes, 204 body absence, and distinct readiness 200/503 schemas.
- [ ] Generic ApiError registrar assertions exempt only readiness 503 and health tests assert exact not-ready content.
- [ ] Public history is fixed server-selected 90 days and pure projection owns filtering/aggregate behavior.
- [ ] Projection-only incident monitor association selects per-monitor history and is absent from public output.
- [ ] Approved delivery list and incident-detail envelopes expose bounded immutable attempts; no unapproved delivery-detail operation exists.
- [ ] Public reachable OpenAPI schemas and runtime output use exact allowlists, not only denylist checks.
- [ ] Header names and likely credential values follow the explicit conservative rejection rules.
- [ ] Deterministic IDs validate UUIDs, integer ranges, canonical UTC, enums, idempotency keys, and malformed Unicode.
- [ ] Every deterministic ID has an exact signature, literal kind tag, canonical field order, key format, and outbox discriminator.
- [ ] Notification files/tests and OpenAPI registrars remain focused rather than omnibus.
- [ ] Later-phase transport, retention, heartbeat-cap, retry, reaper, 15-second worker heartbeat, and complete generation-change policies remain assigned in the handoff table.
- [ ] Every Node/pnpm red-green and verification command uses checked-in executable `scripts/run-node24`, verified as Node 24.18.0 and pnpm 10.30.3.
- [ ] The reviewed plan is committed alone before implementation and final worktree status is clean.

Do not implement persistence for effects in this slice. The Phase 1c database plan must resolve effect references and persist check result, monitor snapshot, incident, timeline, delivery, and outbox rows atomically in the exact order specified here.
