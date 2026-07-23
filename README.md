# OpsPulse

OpsPulse is a self-hosted reliability platform for monitoring HTTP services and background jobs.

## Status

The current runnable vertical slice creates HTTP monitors, schedules and executes checks, persists filtered cursor-paginated history, and opens or resolves incidents in PostgreSQL. Pending checks use PostgreSQL leases and are reclaimed after `2 * timeoutSeconds + 60s` if a worker exits before completion. The Compose stack includes PostgreSQL, a one-shot migration process, the API, and one worker.

This milestone intentionally uses direct PostgreSQL polling for worker scheduling. Redis, an outbox, authentication, notifications, heartbeat monitoring, the private dashboard, and the public status page are still pending. The private API endpoints are unauthenticated and are suitable only for local evaluation.

## Planned Product

The approved product scope includes HTTP and heartbeat monitoring, incident management, webhook notifications, a private operations dashboard, and a public status page.

## Prerequisites

- Node.js 24.18.0
- pnpm 10.30.3
- Docker Engine with Docker Compose

The API defaults to `127.0.0.1` outside containers. Compose explicitly listens on `0.0.0.0` inside its network but publishes port 3000 only on host loopback. Container base images are pinned to inspected content digests.

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

Run the black-box vertical-slice smoke test inside the Compose network, restart the API and worker without replacing either named volume, and verify the original persisted IDs without creating another monitor:

```sh
docker compose run --rm smoke
docker compose restart api worker
docker compose run --rm -e VERIFY_EXISTING=1 smoke
```

The smoke state volume contains only the monitor, check-request, and incident UUIDs. The smoke requires a completed `dns` / `ENOTFOUND` failure and exactly one matching open incident.

Stop containers while retaining PostgreSQL data, or remove the data volume as well:

```sh
docker compose down
docker compose --profile smoke down -v
```

## Design Documents

- [Product specification](docs/superpowers/specs/2026-07-21-opspulse-design.md)
- [Delivery roadmap](docs/superpowers/plans/2026-07-21-opspulse-delivery-roadmap.md)
- [Foundation roadmap](docs/superpowers/plans/2026-07-21-phase-1-foundation-roadmap.md)
- [Workspace scaffold plan](docs/superpowers/plans/2026-07-21-phase-1a-workspace-scaffold.md)

## License

No license has been selected yet.
