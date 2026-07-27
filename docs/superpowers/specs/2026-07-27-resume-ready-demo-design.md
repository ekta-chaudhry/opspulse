# OpsPulse Resume-Ready Demo Design

## Goal

Package the existing HTTP-monitoring vertical slice as a credible recruiter-facing project without expanding product scope. A reviewer should understand the problem, architecture, engineering decisions, and working result within five minutes.

## Scope

The deliverable includes:

- A concise README describing only implemented behavior.
- A Mermaid architecture diagram showing the dashboard, Express API, PostgreSQL scheduler state, worker, checks, and incidents.
- Three or four screenshots covering the operations dashboard, monitor configuration, check history, and an open incident.
- A repeatable demo command that creates a failing HTTP monitor and waits until its failed check and incident are visible.
- A basic GitHub Actions workflow running the existing build, lint, typecheck, and unit-test checks.
- Verification that the documented setup works from a clean checkout.
- Final resume wording delivered in the completion response without creating or modifying a resume file.

Authentication, heartbeat monitoring, webhook delivery, public status pages, Redis/BullMQ, Next.js, observability infrastructure, backups, and deployment automation are explicitly excluded.

## Presentation

The README will lead with the implemented product rather than the future roadmap. It will contain:

1. A short product description and screenshot.
2. Implemented capabilities and explicit limitations.
3. The architecture diagram and key reliability invariants.
4. A quick start using Docker Compose.
5. A deterministic demo flow and expected outcome.
6. Verification commands and current test count.
7. Technology choices and selected engineering highlights.

Screenshots will use seeded non-sensitive data and be stored under `docs/images/`. They must remain legible on GitHub without requiring the application to be running.

## Demo Flow

The demo script will use the existing API and Compose services. It will:

1. Wait for API liveness.
2. Create a uniquely named monitor targeting the reserved `.invalid` domain.
3. Poll bounded API endpoints until a DNS failure and one open incident are persisted.
4. Print the dashboard URL and a compact result summary.
5. Exit nonzero with a stable error message if any step times out.

The script will not add alternate scheduling paths, bypass outbound security policy, or modify production behavior. Existing smoke-state helpers may be reused where doing so keeps the script small.

## CI

One GitHub Actions workflow will install the pinned Node and pnpm versions with a frozen lockfile and run `pnpm check`. It will use dependency caching and minimal permissions. Compose smoke testing remains documented for local execution rather than being added to this minimal CI scope.

## Error Handling

Documentation commands must fail visibly. The demo uses bounded polling and reports whether startup, monitor creation, check completion, or incident creation failed. No credentials, environment values, target headers, or raw internal errors appear in screenshots or demo output.

## Verification

Acceptance requires:

- `scripts/run-node24 pnpm check` passes.
- The demo completes against a freshly started Compose stack.
- Every README command is tested from a clean checkout or isolated worktree.
- README claims match implemented behavior.
- Images render from relative repository paths.
- The GitHub Actions workflow has valid syntax and completes successfully on GitHub.

## Resume Wording

- Built a self-hosted HTTP reliability monitor using TypeScript, Express, PostgreSQL, and Docker Compose, with configurable checks, threshold-based incidents, and restart-safe scheduling.
- Implemented SSRF-resistant outbound requests, generation-safe concurrent monitor updates, PostgreSQL leases, a responsive operations dashboard, and more than 500 automated tests.
