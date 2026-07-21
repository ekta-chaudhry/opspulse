# OpsPulse Design

## Goal

OpsPulse is a self-hosted reliability platform for monitoring HTTP services and background jobs. It detects failures, manages incident state, sends retryable webhook notifications, and exposes both a private operations dashboard and a public status page.

The project is a standalone portfolio product. It is not part of the Production Platform Journey repository, although that learning journey may later improve how OpsPulse is deployed and operated.

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
- A deliberately unreliable sample service for demonstrations and end-to-end tests
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

The initial deployment has one owner account. Private routes require an authenticated session. Public status pages require no authentication.

Heartbeat monitors use a random token embedded in the ping URL. Only a hash of the token is stored. Generic webhook secrets are encrypted at rest and redacted from logs and API responses.

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
- `apps/demo-service`: controllable healthy, slow, and failing HTTP behavior for demonstrations
- `packages/contracts`: shared API schemas, domain types, and event payloads
- `packages/database`: database schema, migrations, and transaction helpers
- `packages/observability`: shared OpenTelemetry and structured-logging setup

The API and worker are separate processes so request handling and background monitoring can fail, restart, and scale independently.

## Core Data Model

### User

- ID
- Email
- Password hash
- Created timestamp

### Monitor

- ID and display name
- Type: HTTP or heartbeat
- Current state: pending, up, degraded, or down
- Public visibility
- Check interval and grace period
- Consecutive failure threshold
- Consecutive recovery threshold
- HTTP URL, method, timeout, and accepted status range for HTTP monitors
- Heartbeat token hash and last heartbeat time for heartbeat monitors
- Last evaluated check time and version used for stale-result protection
- Created and updated timestamps

### CheckRun

- Stable unique check ID
- Monitor ID
- Scheduled time and completion time
- Result: success, failure, or timeout
- HTTP status and latency when applicable
- Failure category and safe error summary
- Immutable creation timestamp

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
- Enabled state
- Created and updated timestamps

### NotificationDelivery

- Stable deduplication key
- Incident event and channel IDs
- Status: queued, delivered, retrying, or failed
- Attempt count, next attempt time, response status, and safe error summary

### WorkerHeartbeat

- Worker identity
- Last-seen timestamp
- Version

This record lets the dashboard distinguish "all monitored services are healthy" from "the monitoring worker is not running."

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
- State and incident changes commit before notification work is queued.
- HTTP failures must meet the configured consecutive-failure threshold before opening an incident.
- Recovery must meet the configured consecutive-success threshold before resolving an incident.
- Repeated heartbeat pings are safe and update the monitor monotonically.

## HTTP Monitoring Flow

BullMQ schedules a stable check job for each enabled HTTP monitor. A worker requests the URL with a bounded timeout, captures status and latency, and stores a `CheckRun`.

Expected target failures such as timeout, connection refusal, DNS failure, or an unacceptable status become failed checks. They do not crash the worker or trigger internal job retries. Internal failures such as unavailable PostgreSQL or Redis cause bounded retries with exponential backoff.

The platform prevents requests to unsafe private or link-local destinations by default to reduce server-side request forgery risk. Redirects are bounded and every redirect target is revalidated.

## Heartbeat Monitoring Flow

A job sends an HTTP request to its heartbeat URL after successful completion. The API hashes the supplied token, finds the monitor, records an idempotent successful `CheckRun`, and evaluates recovery.

A periodic worker job finds heartbeat monitors whose deadline plus grace period has passed. It creates one deterministic missed-heartbeat check for that deadline and evaluates failure thresholds. Repeated sweeps therefore cannot duplicate the same missed check or incident transition.

## Notification Flow

Incident transitions create notification jobs with stable deduplication keys. Delivery uses bounded exponential backoff and records every attempt. Exhausted deliveries move to a dead-letter queue and remain visible in the dashboard for manual replay.

Notification failure never rolls back or hides the underlying incident transition.

## API Shape

The API exposes resource-oriented routes for:

- Authentication and session management
- Monitor creation, update, pause, resume, deletion, and history
- Heartbeat ingestion
- Incident listing and detail timelines
- Notification channel management and test delivery
- Notification replay
- Private dashboard summaries
- Public status-page summaries and incident history
- API, worker, database, and Redis health

Request and response bodies use runtime-validated schemas from `packages/contracts`. Error responses have stable codes and correlation IDs.

## Web Experience

The private dashboard prioritizes operational state rather than generic CRUD tables:

- Overall system health and worker freshness
- Monitor cards with state, last check, latency, and active incident
- Monitor detail with recent check and latency history
- Incident timeline and notification delivery status
- Clear controls to pause a monitor, test a webhook, or replay a failed notification

The public status page shows only explicitly published monitors, current state, recent incidents, and last updated time. Private URLs, errors, tokens, and internal metadata never appear publicly.

## Reliability And Error Handling

- API and worker use graceful shutdown and stop accepting new work before closing dependencies.
- Queue jobs use stable identifiers to prevent accidental duplicate scheduling.
- Database constraints enforce critical invariants in addition to application checks.
- Worker heartbeat freshness is visible and alertable.
- Internal retries are bounded; exhausted work is retained for inspection.
- Check and notification timeouts are explicit.
- Logs are structured and include correlation, monitor, check, incident, and job identifiers where relevant.
- Database migrations are backward-compatible with the currently running application version.

## Security

- Passwords use a memory-hard password hash.
- Sessions use secure, HTTP-only, same-site cookies.
- State-changing browser requests require CSRF protection.
- Public and heartbeat endpoints are rate limited.
- Heartbeat tokens are generated with a cryptographically secure random source and stored only as hashes.
- Webhook secrets are encrypted at rest.
- Logs and traces redact credentials, tokens, private response bodies, and webhook URLs.
- HTTP monitor targets are validated against server-side request forgery.
- Container processes run as non-root users.

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
- End-to-end tests drive the demo service through healthy, slow, failing, and recovered states and verify the dashboard-visible incident lifecycle.
- Security tests cover rate limits, secret redaction, token handling, and unsafe monitor targets.
- Failure drills cover API restart, worker restart, Redis interruption, webhook failure, duplicate jobs, stale results, and service recovery.

## Self-Hosting And Delivery

Docker Compose runs the web, API, worker, demo service, PostgreSQL, Redis, reverse proxy, OpenTelemetry collector, Prometheus, and Grafana components.

Caddy provides reverse proxy configuration and TLS. A free Cloudflare Tunnel can expose the application from a local Linux host without opening a router port. The deployment remains portable to a small VPS later.

GitHub Actions runs static checks, unit tests, integration tests, image builds, and security scans before publishing versioned container images.

PostgreSQL receives scheduled backups. A documented restore drill verifies that a backup is usable.

## Portfolio Evidence

The public repository will include:

- A concise product README with screenshots and a live-demo link
- Architecture and data-flow diagrams
- Local and self-hosted setup instructions
- API examples for HTTP monitors and heartbeat integrations
- Documented reliability invariants and failure drills
- CI status, test, and container-image links
- A short demo script showing failure detection, alert delivery, recovery, and the public status page

A truthful resume description can state:

> Built and self-hosted a TypeScript reliability platform for HTTP services and background jobs, with idempotent incident transitions, retryable webhook delivery, public status pages, distributed tracing, CI/CD, and tested failure recovery.
