# OpsPulse Design

## Goal

OpsPulse is a self-hosted reliability platform for monitoring HTTP services and background jobs. It detects failures, manages incident state, sends retryable webhook notifications, and exposes both a private operations dashboard and a public status page.

The project is a standalone reliability product. It is not part of the Production Platform Journey repository, although that learning journey may later improve how OpsPulse is deployed and operated.

## Product Scope

OpsPulse supports two monitor types:

- HTTP monitors periodically request a configured URL and record availability, status code, and latency.
- Heartbeat monitors expose an unguessable URL that a recurring job calls after successful execution. A missing heartbeat beyond the configured interval and grace period is a failure.

When a monitor crosses its failure threshold, OpsPulse opens one incident, records a timeline event, and queues a webhook notification. A successful recovery check resolves the incident and queues a recovery notification.

The product includes:

- A private dashboard for monitor configuration, current state, check history, latency, incidents, and notification delivery
- A public status page for selected monitors
- Incident history with an append-only timeline
- Configurable generic webhook notifications
- API documentation and example HTTP and heartbeat integrations
- A deliberately unreliable sample service for controlled failure scenarios and end-to-end tests
- Self-monitoring that shows whether the checking worker is healthy

## Non-Goals

The initial product will not include:

- Multi-tenancy or organization management
- SMS, phone calls, or many provider-specific integrations
- Complex escalation policies or on-call schedules
- Browser-based synthetic checks
- Geographic check locations
- Service dependency graphs

These exclusions keep the initial product coherent without reducing the approved HTTP monitoring, heartbeat monitoring, incident, alerting, status-page, observability, and self-hosting scope.

## Users And Access

The initial deployment has one owner account. Private routes require an authenticated session. Public status pages require no authentication. The owner is created with an interactive `pnpm owner:create` command after database initialization. The command fails if an owner already exists. `pnpm owner:reset-password` rotates the password and revokes every existing session; the application never accepts a bootstrap or reset password through HTTP.

Sessions use opaque random tokens and store only token hashes. They expire after 12 hours of inactivity and seven days absolutely. Logout revokes the current session. At login, the server creates a random CSRF token, stores its hash with the session, returns the raw token in the login response, and the browser keeps it only in memory. `GET /v1/sessions/csrf` rotates the token, replaces the stored hash, and returns the new raw token; the server never recovers a token from its hash. Browser mutations send the raw token in `X-CSRF-Token`, which the server compares in constant time. Five failed logins for either an email or source address within 15 minutes cause a 15-minute cooldown while returning a generic authentication error.

Heartbeat monitors use a random token embedded in the ping URL. Only a hash of the token is stored. The token is displayed once when created or rotated; rotation invalidates the previous token immediately. Generic webhook URL and signing secrets are encrypted at rest and redacted from logs and API responses.

## Architecture

```text
Next.js dashboard and public status page
                  |
                  v
        TypeScript Express API
          |                 |
          v                 v
      PostgreSQL         Redis/BullMQ
  durable source of      scheduled and
       truth             retryable work
                            |
                            v
                     TypeScript worker
                  checks URLs, detects late
                  heartbeats, sends webhooks
```

The repository contains these units:

- `apps/api`: authentication, monitor management, heartbeat ingestion, incidents, public status, and internal health endpoints
- `apps/worker`: HTTP checks, missed-heartbeat evaluation, monitor state transitions, retries, and notification delivery
- `apps/web`: private dashboard and public status pages
- `apps/sample-service`: controllable healthy, slow, and failing HTTP behavior for validation
- `packages/contracts`: shared API schemas, domain types, and event payloads
- `packages/domain`: pure state evaluation, transition invariants, deterministic identifiers, and webhook payload construction
- `packages/database`: database schema, migrations, and transaction helpers
- `packages/observability`: shared OpenTelemetry and structured-logging setup

The API and worker are separate processes so request handling and background monitoring can fail, restart, and scale independently. `packages/domain` owns the state evaluator used by API heartbeat ingestion and worker check completion. `apps/worker` has separate scheduler, checker, outbox-dispatcher, and notifier entry points; each publishes a role-specific heartbeat. API code does not duplicate worker orchestration.

PostgreSQL is the source of truth for monitor lifecycle, due checks, state transitions, incidents, and notification deliveries. BullMQ is an execution mechanism, not the authoritative schedule. Transactional outbox rows bridge committed PostgreSQL work to Redis queues. Idempotent dispatchers and periodic reconciliation close crash windows between the database and Redis.

## Core Data Model

### User

- ID
- Email
- Password hash
- Created timestamp

### OwnerSession

- Session token hash and CSRF secret hash
- Created, last-seen, absolute-expiry, and revoked timestamps
- Safe client metadata for owner-visible session revocation

### Monitor

- ID and display name
- Type: HTTP or heartbeat
- Current state: pending, up, degraded, or down
- Lifecycle: active, paused, or archived
- Public visibility
- Check interval and grace period
- Consecutive failure threshold
- Consecutive recovery threshold
- Persisted consecutive failure and success counters
- HTTP URL, method, timeout, and accepted status range for HTTP monitors
- Optional non-secret HTTP request headers
- Heartbeat token hash and last heartbeat time for heartbeat monitors
- Next HTTP check time or next heartbeat deadline
- Schedule generation, next sequence, last evaluated sequence, and last evaluated check time for stale-result protection
- Created and updated timestamps

### CheckRun

- Stable unique check ID
- Monitor ID
- Monitor schedule generation and monotonic sequence
- Optional check request ID
- Scheduled time and completion time
- Result: success, failure, or timeout
- HTTP status and latency when applicable
- Failure category and safe error summary
- Immutable creation timestamp
- Evaluation timestamp

### CheckRequest

- Deterministic request ID
- Monitor ID, schedule generation, and monotonic sequence
- Source: HTTP schedule or missed-heartbeat deadline
- Scheduled time
- Status: pending, completed, or cancelled-internal
- Created and terminal timestamps

The scheduler persists `CheckRequest`; workers persist immutable `CheckRun` results referencing it. A direct heartbeat ping creates its request and successful result together. State evaluation never reinserts or mutates a result.

### Incident

- Monitor ID
- Status: open or resolved
- Started and resolved timestamps
- Opening cause and latest observed cause
- A database constraint allowing at most one open incident per monitor

### IncidentEvent

- Incident ID
- Event type: opened, failure observed, notification queued, recovery observed, or resolved
- Structured details
- Timestamp

### NotificationChannel

- Name
- Webhook URL ciphertext
- Webhook signing-secret ciphertext
- Enabled state
- Lifecycle: active or archived
- Created and updated timestamps

### MonitorNotificationChannel

- Monitor and channel IDs
- Enabled state
- Unique constraint on the pair

### NotificationDelivery

- Stable deduplication key
- Incident event and channel IDs
- Status: queued, delivered, retrying, or failed
- Attempt count, next attempt time, response status, and safe error summary
- Optional replay-of delivery ID

### NotificationAttempt

- Delivery ID and attempt number
- Started and completed timestamps
- Outcome, response status, and safe error summary

### OutboxEvent

- Stable event ID and type
- Aggregate ID and structured payload
- Created, dispatched, and next-attempt timestamps
- Attempt count and last safe error

Outbox types include `check.requested`, `notification.requested`, and maintenance work. A unique event ID makes dispatch to BullMQ repeatable.

### WorkerHeartbeat

- Worker identity
- Role: scheduler, checker, outbox dispatcher, or notifier
- Last-seen timestamp
- Version

This record lets the dashboard distinguish "all monitored services are healthy" from "the monitoring worker is not running."

### Retention And Deletion

Monitors are archived rather than hard deleted. Archiving increments the schedule generation, stops future checks, removes the monitor from public status, and preserves checks and incidents. Check runs are retained for 30 days by default. Incident timelines and notification history are retained until an owner explicitly runs the documented maintenance command. Public status pages show at most 90 days of incident history.

Archiving transactionally resolves an open incident with reason `monitor_archived`, appends the timeline event, and creates the normal resolved notification deliveries before removing the monitor from public projections. Archived monitors are immutable except for retention maintenance.

## Configuration Defaults And Limits

- Check interval: 30 seconds to 24 hours; default 60 seconds
- Heartbeat grace period: 0 seconds to 24 hours; default 60 seconds
- Failure threshold: 1 to 10; default 2
- Recovery threshold: 1 to 10; default 1
- HTTP timeout: 1 to 30 seconds; default 5 seconds
- HTTP methods: `GET` and `HEAD` only
- Accepted status: configurable inclusive range; default 200 through 399
- Redirects: maximum 3, with every destination revalidated
- Response body: never persisted; at most 64 KiB is read and discarded
- Check history retention: 1 to 365 days; default 30 days

Changing scheduling fields or pausing, resuming, or archiving a monitor increments its schedule generation. Work carrying an older generation is stale and cannot update state.

## Monitor State Evaluation

State evaluation is a transactional domain operation.

```text
scheduled check or received heartbeat
                  |
                  v
       insert immutable CheckRun
                  |
                  v
 lock monitor and compare check version/time
                  |
        +---------+----------+
        |                    |
   stale/duplicate       current result
        |                    |
      finish          evaluate thresholds
                             |
                    +--------+--------+
                    |                 |
              no transition     state transition
                    |                 |
                  finish       update monitor,
                               incident, timeline
                                     |
                                     v
                              queue notification
```

The following invariants apply:

- A monitor has at most one open incident.
- Duplicate check results cannot create duplicate incidents, timeline transitions, or notifications.
- An older result cannot overwrite a state derived from a newer result.
- Check insertion, monitor state, incident state, timeline events, notification deliveries, and corresponding outbox events commit in one PostgreSQL transaction.
- HTTP failures must meet the configured consecutive-failure threshold before opening an incident.
- Recovery must meet the configured consecutive-success threshold before resolving an incident.
- Repeated heartbeat pings are safe and update the monitor monotonically.

The monitor row is locked during evaluation. Evaluation processes terminal requests in contiguous sequence order beginning after `last_evaluated_sequence`; a later completed request waits while an earlier request remains pending. Completed requests apply their immutable result. A request marked `cancelled-internal` advances the sequence without changing target-health counters and exposes an internal monitoring error. Current failures increment the persisted failure counter and reset the success counter. Current successes do the opposite. Duplicate check and request IDs use insert conflicts as successful no-ops.

Only one HTTP request may be pending per monitor, preventing overlapping target checks. Heartbeat pings and missed deadlines serialize on the monitor row. These rules ensure every target result contributing to a threshold is evaluated exactly once and in order.

### State Transitions

| Current state | Current result | Threshold status | Next state | Incident behavior |
| --- | --- | --- | --- | --- |
| pending | success | recovery not reached | pending | none |
| pending | success | recovery reached | up | none |
| pending | failure | failure not reached | degraded | none |
| pending | failure | failure reached | down | open incident |
| up | success | any | up | none |
| up | failure | failure not reached | degraded | none |
| degraded | failure | failure not reached | degraded | keep existing incident if any |
| up or degraded | failure | failure reached | down | open or update incident |
| degraded | success | recovery not reached | degraded | keep existing incident if any |
| down | success | recovery not reached | degraded | keep incident open |
| degraded or down | success | recovery reached | up | resolve open incident |
| down | failure | any | down | append failure observation only when the cause materially changes |

Paused monitors retain their last internal state but appear as `maintenance` publicly and do not contribute to aggregate status. Resuming sets the state to `pending`, resets counters, increments the generation, and schedules fresh work. Archived monitors do not appear publicly and cannot be resumed.

## Monitor Scheduling Lifecycle

A PostgreSQL reconciler owns schedule creation:

1. Lock due active monitor rows with `SKIP LOCKED`.
2. Create deterministic pending `CheckRequest` records and `check.requested` outbox rows for due HTTP checks. Missed heartbeat deadlines are materialized and evaluated synchronously while holding the monitor row lock.
3. Advance `next_check_at` or `next_heartbeat_deadline` in the same transaction.
4. Dispatch outbox events to BullMQ using the outbox event ID as the job ID.
5. Mark the outbox row dispatched only after BullMQ accepts the idempotent job.

Creation and resume initialize the next due time. Interval changes increment the generation, reset generation-scoped sequence counters, cancel old-generation pending requests, and calculate a fresh due time from the change timestamp. Pause and archive do the same while stopping new work. A periodic reconciliation pass safely recreates undispatched work after API, worker, Redis, or PostgreSQL restarts. BullMQ jobs with old generations finish as no-ops. No BullMQ repeatable schedule is authoritative, so orphaned queue schedules cannot diverge from PostgreSQL.

Every requested or received check allocates the monitor's next sequence while holding the monitor row lock. The reconciler does not schedule another HTTP request while one remains pending. HTTP intervals missed because the OpsPulse worker was unavailable collapse into one current check after recovery, then continue from recovery time; OpsPulse does not invent target failures for periods in which it made no request.

After six exhausted internal checker attempts, the failure handler marks the request `cancelled-internal` and runs ordered evaluation so later checks are not blocked. A reaper also cancels pending requests older than twice their configured HTTP timeout plus 60 seconds, covering lost queue jobs or terminated workers. A late result for a cancelled or old-generation request is retained as diagnostic evidence but cannot affect target state.

## HTTP Monitoring Flow

The PostgreSQL reconciler requests a stable check for each due HTTP monitor. A BullMQ worker performs a `GET` or `HEAD` request with the configured bounded timeout and captures status and latency. In one transaction it locks the pending `CheckRequest`, inserts the immutable `CheckRun`, marks the request completed, and invokes ordered evaluation. Custom request bodies and credential-bearing URLs are not supported initially. Optional request headers may contain non-secret values only; authenticated private targets are outside the initial scope.

Expected target failures such as timeout, connection refusal, DNS failure, or an unacceptable status become failed checks. They do not crash the worker or trigger internal job retries. Internal failures such as unavailable PostgreSQL or Redis cause bounded retries with exponential backoff.

The platform prevents requests to loopback, private, link-local, multicast, metadata, and otherwise prohibited destinations by default to reduce server-side request forgery risk. URL credentials are rejected. A shared safe outbound client resolves and validates every IPv4 and IPv6 address, connects to one validated pinned address without re-resolving, and preserves the original hostname for the HTTP `Host` header and TLS SNI and certificate verification. Proxy environment variables are ignored. Redirects are bounded and every redirect target is independently resolved, validated, and pinned. The same client and policy apply to webhook destinations.

## Heartbeat Monitoring Flow

A job sends `POST /v1/heartbeats/:token` after successful completion. It should include an `Idempotency-Key` stable for that job execution. The API hashes the token, finds the monitor, and derives the check ID from the monitor ID and idempotency key. Without the header, the API accepts the ping with a generated check ID, but callers lose network-retry deduplication.

An accepted ping locks the monitor and first materializes and evaluates every elapsed deadline up to its server-received time, capped at 100 per transaction. It then allocates the next sequence, inserts the heartbeat request and successful result, evaluates it, stores the received time, and sets the next deadline to received time plus interval plus grace period. A periodic reconciler uses the same locked operation to materialize elapsed deadlines as deterministic failure requests and results keyed by monitor ID, generation, and deadline.

The ping API and missed-deadline reconciler lock the same monitor row. A ping received before the stored deadline advances the deadline without a failure. A ping received after a deadline cannot overtake it: elapsed failures are committed and evaluated first, followed by the successful recovery result. This ordering prevents a timely ping from racing into a false incident while preserving evidence of genuinely late execution.

## Notification Flow

Each monitor selects zero or more notification channels through `MonitorNotificationChannel`. An incident opened or resolved transition creates one `NotificationDelivery` and one outbox event per selected enabled channel. The stable deduplication key combines incident event, channel, and payload version.

Archiving a channel disables it for future incident transitions and removes it from default lists. Already-created deliveries retain their encrypted destination and continue to their terminal state for auditability. Archived channels are immutable and can be included only through an explicit list filter; they cannot be reactivated.

The versioned `opspulse.webhook.v1` JSON payload contains event ID, event type, occurred time, monitor public identity, current state, incident identity, and safe summary. Requests include `X-OpsPulse-Event-ID`, `X-OpsPulse-Timestamp`, `X-OpsPulse-Signature-Version`, and an HMAC-SHA256 signature over timestamp plus raw body. The event ID is the receiver's idempotency key.

Delivery times out after 5 seconds, does not follow redirects, reads at most 64 KiB of response, and treats 200 through 299 as success. Status 408, 425, 429, and 500 through 599 plus network failures are retryable. Other 4xx responses are final failures. Delivery uses bounded exponential backoff with jitter for six attempts. Every attempt creates an immutable `NotificationAttempt`. Exhausted deliveries remain failed and visible in the dashboard.

Manual replay is available only for final failed deliveries. It creates a new delivery ID with `replay_of_delivery_id` pointing to the original and adds `X-OpsPulse-Replay-Of`; it does not mutate the original. Replay deduplication keys append `:replay:<monotonic replay number>` to the original key, while the original event ID remains in the payload for receiver-side correlation. An owner must explicitly confirm each replay.

Notification failure never rolls back or hides the underlying incident transition.

## API Shape

The API is documented with OpenAPI generated from runtime schemas in `packages/contracts`. JSON endpoints live under `/v1`.

| Area | Operations |
| --- | --- |
| Auth | `POST /sessions`, `DELETE /sessions/current`, `GET /sessions/current`, `GET /sessions/csrf` |
| Monitors | create, list, get, update, pause, resume, archive, rotate heartbeat token, list checks |
| Heartbeats | unauthenticated token-based `POST /heartbeats/:token` with optional idempotency key |
| Incidents | list, get with timeline |
| Channels | create, list, update, archive, test webhook |
| Deliveries | list and explicitly replay a final failed delivery |
| Dashboard | authenticated summary and worker freshness |
| Public status | aggregate status, published monitors, and bounded incident history |
| Health | liveness and dependency readiness for API and worker roles |

Private operations require the owner session and CSRF token for mutations. Public status returns only explicitly projected fields. List APIs use cursor pagination with a default of 25 and maximum of 100, stable newest-first ordering, and documented state, monitor, and time filters.

Validation conflicts return `409`; malformed input returns `400`; unauthenticated and unauthorized requests return `401` and `403`; missing and archived resources return `404`; rate limits return `429`. Error responses contain a stable code, safe message, details where appropriate, and correlation ID. Monitor names are 1 to 100 characters. URLs are limited to 2,048 characters. Unknown fields are rejected.

## Web Experience

The private dashboard prioritizes operational state rather than generic CRUD tables:

- Overall system health and worker freshness
- Monitor cards with state, last check, latency, and active incident
- Monitor detail with recent check and latency history
- Incident timeline and notification delivery status
- Clear controls to pause a monitor, test a webhook, or replay a failed notification

The public status page shows only explicitly published monitors, current state, recent incidents, and last updated time. Private URLs, errors, tokens, and internal metadata never appear publicly.

Public states map as follows: pending is `unknown`, up is `operational`, degraded is `degraded`, down is `outage`, and paused is `maintenance`. Aggregate status is the worst state among active published monitors. Maintenance monitors are displayed but excluded from the aggregate. If no scheduler or checker heartbeat is fresh within 60 seconds, the page displays `monitoring unavailable`, marks the aggregate unknown, and never reports all systems operational. Public incident history is limited to 90 days.

## Reliability And Error Handling

- API and worker use graceful shutdown and stop accepting new work before closing dependencies.
- Queue jobs use stable identifiers to prevent accidental duplicate scheduling.
- Database constraints enforce critical invariants in addition to application checks.
- Scheduler, checker, outbox-dispatcher, and notifier instances update role-specific heartbeats every 15 seconds. Instances expire after 60 seconds. A role is healthy when at least one instance is fresh. Public monitoring availability requires fresh scheduler and checker roles; the private dashboard reports all four roles separately.
- Internal retries are bounded; exhausted work is retained for inspection.
- Check and notification timeouts are explicit.
- Logs are structured and include correlation, monitor, check, incident, and job identifiers where relevant.
- Database migrations are backward-compatible with the currently running application version.

When Redis is unavailable, PostgreSQL continues retaining due checks and notification requests in the outbox. Dispatch resumes and reconciles after Redis recovers. When PostgreSQL is unavailable, workers retry internal jobs without committing target outcomes; deterministic check IDs make a repeated target request safe to persist once PostgreSQL returns. A target success that cannot be persisted is not considered observed until persistence succeeds.

OpsPulse cannot reliably alert through itself when every local component or the host is down. `/health/ready` and the public worker-freshness signal are designed for one independent external monitor. The self-hosting guide states this limitation rather than claiming complete self-monitoring.

## Security

- Passwords use a memory-hard password hash.
- Sessions use secure, HTTP-only, same-site cookies.
- State-changing browser requests require CSRF protection.
- Public and heartbeat endpoints are rate limited.
- Heartbeat tokens are generated with a cryptographically secure random source and stored only as hashes.
- Webhook secrets are encrypted at rest.
- Logs and traces redact credentials, tokens, private response bodies, and webhook URLs.
- HTTP monitor and webhook targets share server-side request forgery protection covering IPv4, IPv6, redirect targets, DNS rebinding, URL credentials, metadata ranges, and proxy bypass.
- Container processes run as non-root users.

Webhook URLs are encrypted with AES-256-GCM using a versioned master key supplied outside the database. A local administrative rotation command decrypts with the previous key and re-encrypts with the active key. Startup fails closed when required keys are missing or malformed.

## Observability

All services emit structured logs and OpenTelemetry traces. Prometheus-compatible metrics include:

- API request rate, errors, and duration
- Check count, failure count, and duration
- Monitor state counts
- Incident opened and resolved counts
- Queue depth, queue delay, retries, and dead-letter count
- Notification delivery latency and failures
- Database and Redis operation duration
- Worker heartbeat age

Trace context propagates through HTTP requests and BullMQ jobs. A Grafana dashboard presents platform health and the metrics required for failure drills.

## Testing

- Unit tests cover threshold evaluation, state transitions, stale results, duplicate results, and notification deduplication.
- API tests cover authentication, authorization, monitor management, heartbeat idempotency, validation, and public-data filtering.
- Integration tests use real PostgreSQL and Redis containers for transactions, constraints, queues, and retries.
- Worker tests cover HTTP outcomes, timeouts, missed heartbeats, internal retries, dead-letter handling, and notification replay.
- End-to-end tests drive the sample service through healthy, slow, failing, and recovered states and verify the dashboard-visible incident lifecycle.
- Security tests cover rate limits, secret redaction, token handling, and unsafe monitor targets.

Failure drills have explicit pass criteria:

| Drill | Injection | Required evidence |
| --- | --- | --- |
| API restart | Terminate API during requests | Health check fails, process restarts, no committed data is lost |
| Worker restart | Terminate checker with queued work | Another or restarted worker completes deterministic jobs without duplicate transitions |
| Redis interruption | Stop Redis while checks become due | Outbox backlog grows, no events are lost, dispatch catches up after recovery |
| PostgreSQL interruption | Stop PostgreSQL after a target response | Job retries, deterministic check persists once, state changes once after recovery |
| Webhook failure | Return retryable failures then success | Attempts and backoff are recorded, one delivery eventually succeeds |
| Duplicate job | Enqueue the same event ID repeatedly | One check or delivery result and one domain transition exist |
| Stale result | Delay an old-generation check past a newer result | Stale result is stored or classified but cannot change monitor state |
| Service recovery | Move sample service from failing to healthy | Thresholds resolve one incident and send one recovery event |

Automated drills assert database rows, queue state, emitted telemetry, public status, and eventual recovery. The repository also documents manual commands for a reviewer to reproduce each drill.

## Self-Hosting And Delivery

Docker Compose runs the web, API, worker, sample service, PostgreSQL, Redis, reverse proxy, OpenTelemetry collector, Prometheus, and Grafana components.

Caddy provides reverse proxy configuration and TLS. A free Cloudflare Tunnel can expose the application from a local Linux host without opening a router port. The deployment remains portable to a small VPS later.

Required configuration includes database and Redis URLs, public origins, session and encryption keys, image versions, retention settings, Cloudflare credentials when enabled, and initial owner-creation instructions. A checked-in `.env.example` documents every value without secrets. Secret-generation and webhook-key-rotation commands are part of the repository.

PostgreSQL, Redis, Prometheus, and Grafana use named persistent volumes. Only Caddy or Cloudflare Tunnel exposes public ports; databases, Redis, telemetry backends, and internal health endpoints stay on private Compose networks. Services retry dependencies with bounded startup backoff. A one-shot migration service runs before API and worker startup.

The full local stack targets a Linux host with at least 2 CPU cores, 4 GiB RAM, and 10 GiB free storage. A reduced application profile may omit Prometheus and Grafana for development, but the full deployment includes them.

GitHub Actions runs static checks, unit tests, integration tests, image builds, and security scans before publishing immutable commit-SHA and release-tag container images. Deployment is a protected manual workflow that connects to the self-hosted machine, writes only approved image tags, runs the backup and migration jobs, pulls images, and performs `docker compose up`. Health checks gate completion.

Migrations are forward-only and backward-compatible with the previous application version. Upgrade order is backup, migrate, start new API and worker, verify health, then remove old images. Application rollback pins the previous image tags. A migration that cannot remain backward-compatible requires a separately reviewed maintenance release.

PostgreSQL receives an encrypted daily `pg_dump`, retaining seven daily and four weekly backups. Backups are stored outside the database volume and may be copied to an owner-provided S3-compatible bucket. A monthly restore drill loads the newest backup into a temporary database and must pass schema-version, row-count, owner-login, monitor-list, and incident-history smoke checks.

## Project Evidence

The public repository will include:

- A concise product README with screenshots and a live environment link
- Architecture and data-flow diagrams
- Local and self-hosted setup instructions
- API examples for HTTP monitors and heartbeat integrations
- Documented reliability invariants and failure drills
- CI status, test, and container-image links
- A short failure-scenario script showing failure detection, alert delivery, recovery, and the public status page

A concise project summary can state:

> Built and self-hosted a TypeScript reliability platform for HTTP services and background jobs, with idempotent incident transitions, retryable webhook delivery, public status pages, distributed tracing, CI/CD, and tested failure recovery.
