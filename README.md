# OpsPulse

OpsPulse is a self-hosted reliability platform for monitoring HTTP services and background jobs.

## Status

The current runnable vertical slice creates HTTP monitors, schedules and executes checks, persists check history, and opens or resolves incidents in PostgreSQL. The Compose stack includes PostgreSQL, a one-shot migration process, the API, and one worker.

This milestone intentionally uses direct PostgreSQL polling for worker scheduling. Redis, an outbox, authentication, notifications, heartbeat monitoring, the private dashboard, and the public status page are still pending. The private API endpoints are unauthenticated and are suitable only for local evaluation.

## Planned Product

The approved product scope includes HTTP and heartbeat monitoring, incident management, webhook notifications, a private operations dashboard, and a public status page.

## Prerequisites

- Node.js 24.18.0
- pnpm 10.30.3
- Docker Engine with Docker Compose

Host-side Node commands should run through the checked-in Node 24 wrapper:

```sh
scripts/run-node24 pnpm install --frozen-lockfile
scripts/run-node24 pnpm check
```

## Run With Compose

Build and start the vertical slice, waiting for the API healthcheck:

```sh
docker compose build
docker compose up -d --wait postgres migrate api worker
```

Check liveness from the host-bound loopback port:

```sh
curl --fail --silent --show-error http://127.0.0.1:3000/health/live
```

Run the black-box vertical-slice smoke test inside the Compose network:

```sh
docker compose run --rm smoke
```

Stop containers while retaining PostgreSQL data, or remove the data volume as well:

```sh
docker compose down
docker compose down -v
```

## Design Documents

- [Product specification](docs/superpowers/specs/2026-07-21-opspulse-design.md)
- [Delivery roadmap](docs/superpowers/plans/2026-07-21-opspulse-delivery-roadmap.md)
- [Foundation roadmap](docs/superpowers/plans/2026-07-21-phase-1-foundation-roadmap.md)
- [Workspace scaffold plan](docs/superpowers/plans/2026-07-21-phase-1a-workspace-scaffold.md)

## License

No license has been selected yet.
