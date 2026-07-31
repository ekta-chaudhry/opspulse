import {
  HeartbeatHeadersSchema,
  HeartbeatTokenParamsSchema,
  type FailureCause,
  type HeartbeatAccepted,
  type HeartbeatHeaders,
} from "@opspulse/contracts";
import { evaluateMonitorResult } from "@opspulse/domain";
import { createHash, randomUUID } from "node:crypto";
import { createIncidentNotificationDeliveries } from "./notification-deliveries.js";
import { HTTP_MONITOR_COLUMNS } from "./monitors.js";
import { toIncidentSummary, toPrivateHeartbeatMonitor } from "./rows.js";
import { withTransaction, type TransactionClient, type TransactionPool } from "./transaction.js";

export class HeartbeatTokenNotFoundError extends Error {
  constructor() {
    super("Heartbeat token does not exist");
    this.name = "HeartbeatTokenNotFoundError";
  }
}

const heartbeatTokenHash = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

function uuidFromHash(input: string): string {
  const hex = createHash("sha256").update(input).digest("hex").slice(0, 32).split("");
  hex[12] = "8";
  const variant = Number.parseInt(hex[16] ?? "0", 16);
  hex[16] = ((variant & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function checkIdForPing(monitorId: string, idempotencyKey: string | undefined): string {
  return idempotencyKey === undefined
    ? randomUUID()
    : uuidFromHash(`opspulse.heartbeat-request.v1\0${monitorId}\0${idempotencyKey}`);
}

async function appendIncidentEvent(
  client: TransactionClient,
  incidentId: string,
  type: "opened" | "failure_observed" | "recovery_observed" | "resolved",
  occurredAt: Date,
  details: object,
): Promise<string> {
  const result = await client.query(
    `INSERT INTO incident_events (incident_id, type, occurred_at, details)
    VALUES ($1, $2, $3, $4::jsonb)
    RETURNING id`,
    [incidentId, type, occurredAt, JSON.stringify(details)],
  );
  const row = result.rows[0] as { id?: unknown } | undefined;
  if (typeof row?.id !== "string") throw new Error("incident event insert returned no id");
  return row.id;
}

const heartbeatLateCause: FailureCause = {
  category: "heartbeat_late",
  code: "HEARTBEAT_DEADLINE_MISSED",
  httpStatus: null,
  safeSummary: "Heartbeat deadline missed",
};

export async function materializeDueHeartbeatDeadline(
  pool: TransactionPool,
  now: Date = new Date(),
): Promise<boolean> {
  return withTransaction(pool, async (client) => {
    const due = await client.query(
      `SELECT ${HTTP_MONITOR_COLUMNS}
      FROM monitors m
      LEFT JOIN incidents i ON i.id = m.active_incident_id
      WHERE m.kind = 'heartbeat'
        AND m.lifecycle = 'active'
        AND m.next_heartbeat_deadline <= $1
      ORDER BY m.next_heartbeat_deadline, m.id
      LIMIT 1
      FOR UPDATE OF m SKIP LOCKED`,
      [now],
    );
    const monitorRow = due.rows[0];
    if (monitorRow === undefined) return false;
    const monitor = toPrivateHeartbeatMonitor(monitorRow);
    if (monitor.nextHeartbeatDeadline === null) return false;
    const deadline = new Date(monitor.nextHeartbeatDeadline);
    const requestId = uuidFromHash(
      `opspulse.missed-heartbeat-request.v1\0${monitor.id}\0${String(monitor.generation)}\0${String(monitor.nextSequence)}\0${deadline.toISOString()}`,
    );
    const sequence = monitor.nextSequence;

    await client.query(
      `INSERT INTO check_requests (
        id, monitor_id, generation, sequence, source, status, scheduled_at,
        terminal_at, created_at
      ) VALUES ($1, $2, $3, $4, 'heartbeat_deadline', 'completed', $5, $6, $6)`,
      [requestId, monitor.id, String(monitor.generation), String(sequence), deadline, now],
    );
    await client.query(
      `INSERT INTO check_runs (
        request_id, monitor_id, generation, sequence, result, http_status,
        latency_ms, cause, completed_at, evaluated_at
      ) VALUES ($1, $2, $3, $4, 'failure', NULL, NULL, $5::jsonb, $6, $6)`,
      [requestId, monitor.id, String(monitor.generation), String(sequence), JSON.stringify(heartbeatLateCause), now],
    );

    const evaluation = evaluateMonitorResult(
      {
        state: monitor.state,
        failureThreshold: monitor.failureThreshold,
        recoveryThreshold: monitor.recoveryThreshold,
        consecutiveFailures: monitor.consecutiveFailures,
        consecutiveSuccesses: monitor.consecutiveSuccesses,
        hasOpenIncident: monitor.activeIncident !== null,
      },
      { result: "failure", cause: heartbeatLateCause },
    );

    let activeIncident = monitor.activeIncident;
    if (evaluation.transition.type === "incident.open") {
      const insertedIncident = await client.query(
        `INSERT INTO incidents (
          monitor_id, monitor_name, started_at, opening_cause, latest_cause
        ) VALUES ($1, $2, $3, $4::jsonb, $4::jsonb)
        RETURNING id, status, started_at, latest_cause`,
        [monitor.id, monitor.name, now, JSON.stringify(heartbeatLateCause)],
      );
      const incidentRow = insertedIncident.rows[0];
      if (incidentRow === undefined) throw new Error("incident insert returned no row");
      activeIncident = toIncidentSummary(incidentRow);
      const eventId = await appendIncidentEvent(client, activeIncident.id, "opened", now, {
        cause: heartbeatLateCause,
      });
      await createIncidentNotificationDeliveries(client, {
        monitor: {
          id: monitor.id,
          name: monitor.name,
          state: "down",
          publicSlug: monitor.publicSlug,
        },
        incidentEventId: eventId,
        occurredAt: now,
        transition: {
          type: "opened",
          cause: heartbeatLateCause,
          incident: { id: activeIncident.id, startedAt: activeIncident.startedAt },
        },
      });
    } else if (evaluation.transition.type === "incident.observe") {
      if (activeIncident === null) throw new Error("incident observation requires an incident");
      const previousCause = activeIncident.latestCause;
      const updatedIncident = await client.query(
        `UPDATE incidents
        SET latest_cause = $2::jsonb
        WHERE id = $1 AND status = 'open'
        RETURNING id, status, started_at, latest_cause`,
        [activeIncident.id, JSON.stringify(heartbeatLateCause)],
      );
      const incidentRow = updatedIncident.rows[0];
      if (incidentRow === undefined) throw new Error("open incident update returned no row");
      activeIncident = toIncidentSummary(incidentRow);
      await appendIncidentEvent(client, activeIncident.id, "failure_observed", now, {
        previousCause,
        nextCause: heartbeatLateCause,
      });
    }

    await client.query(
      `UPDATE monitors
      SET state = $2,
          consecutive_failures = $3,
          consecutive_successes = $4,
          next_sequence = next_sequence + 1,
          last_evaluated_sequence = $5,
          last_evaluated_check_at = $6,
          active_incident_id = $7,
          next_heartbeat_deadline = next_heartbeat_deadline +
            (interval_seconds + grace_period_seconds) * interval '1 second',
          updated_at = $6
      WHERE id = $1`,
      [
        monitor.id,
        evaluation.nextSnapshot.state,
        String(evaluation.nextSnapshot.consecutiveFailures),
        String(evaluation.nextSnapshot.consecutiveSuccesses),
        String(sequence),
        now,
        activeIncident?.id ?? null,
      ],
    );

    return true;
  });
}

export async function recordHeartbeatPing(
  pool: TransactionPool,
  token: string,
  headers: HeartbeatHeaders = {},
  now: Date = new Date(),
): Promise<HeartbeatAccepted> {
  const { token: parsedToken } = HeartbeatTokenParamsSchema.parse({ token });
  const parsedHeaders = HeartbeatHeadersSchema.parse(headers);
  return withTransaction(pool, async (client) => {
    const locked = await client.query(
      `SELECT ${HTTP_MONITOR_COLUMNS}
      FROM monitors m
      LEFT JOIN incidents i ON i.id = m.active_incident_id
      WHERE m.kind = 'heartbeat'
        AND m.lifecycle = 'active'
        AND m.heartbeat_token_hash = $1
      FOR UPDATE OF m`,
      [heartbeatTokenHash(parsedToken)],
    );
    const monitorRow = locked.rows[0];
    if (monitorRow === undefined) throw new HeartbeatTokenNotFoundError();
    const monitor = toPrivateHeartbeatMonitor(monitorRow);
    const idempotencyKey = parsedHeaders["idempotency-key"];
    const checkId = checkIdForPing(monitor.id, idempotencyKey);

    if (idempotencyKey !== undefined) {
      const existing = await client.query(
        `SELECT id FROM check_requests
        WHERE id = $1 AND monitor_id = $2 AND source = 'heartbeat_ping'`,
        [checkId, monitor.id],
      );
      if (existing.rows[0] !== undefined) {
        return { checkId, receivedAt: now.toISOString(), deduplicated: true };
      }
    }

    const sequence = monitor.nextSequence;
    await client.query(
      `INSERT INTO check_requests (
        id, monitor_id, generation, sequence, source, status, scheduled_at,
        terminal_at, created_at
      ) VALUES ($1, $2, $3, $4, 'heartbeat_ping', 'completed', $5, $5, $5)`,
      [checkId, monitor.id, String(monitor.generation), String(sequence), now],
    );
    await client.query(
      `INSERT INTO check_runs (
        request_id, monitor_id, generation, sequence, result, http_status,
        latency_ms, cause, completed_at, evaluated_at
      ) VALUES ($1, $2, $3, $4, 'success', NULL, NULL, NULL, $5, $5)`,
      [checkId, monitor.id, String(monitor.generation), String(sequence), now],
    );

    const evaluation = evaluateMonitorResult(
      {
        state: monitor.state,
        failureThreshold: monitor.failureThreshold,
        recoveryThreshold: monitor.recoveryThreshold,
        consecutiveFailures: monitor.consecutiveFailures,
        consecutiveSuccesses: monitor.consecutiveSuccesses,
        hasOpenIncident: monitor.activeIncident !== null,
      },
      { result: "success", cause: null },
    );

    let activeIncident = monitor.activeIncident;
    if (evaluation.transition.type === "incident.resolve") {
      if (activeIncident === null) throw new Error("incident resolution requires an incident");
      const incidentId = activeIncident.id;
      await appendIncidentEvent(client, incidentId, "recovery_observed", now, {
        consecutiveSuccesses: monitor.consecutiveSuccesses + 1,
        recoveryThreshold: monitor.recoveryThreshold,
      });
      await client.query(
        `UPDATE incidents
        SET status = 'resolved', resolved_at = $2, resolution_reason = 'recovered'
        WHERE id = $1 AND status = 'open'`,
        [incidentId, now],
      );
      const eventId = await appendIncidentEvent(client, incidentId, "resolved", now, {
        reason: evaluation.transition.reason,
      });
      await createIncidentNotificationDeliveries(client, {
        monitor: {
          id: monitor.id,
          name: monitor.name,
          state: evaluation.nextSnapshot.state,
          publicSlug: monitor.publicSlug,
        },
        incidentEventId: eventId,
        occurredAt: now,
        transition: {
          type: "resolved",
          resolution: evaluation.transition.reason,
          incident: {
            id: incidentId,
            startedAt: activeIncident.startedAt,
            resolvedAt: now.toISOString(),
          },
        },
      });
      activeIncident = null;
    } else if (activeIncident !== null) {
      const updatedIncident = await client.query(
        `SELECT id, status, started_at, latest_cause
        FROM incidents
        WHERE id = $1 AND status = 'open'`,
        [activeIncident.id],
      );
      const incidentRow = updatedIncident.rows[0];
      if (incidentRow !== undefined) activeIncident = toIncidentSummary(incidentRow);
      await appendIncidentEvent(client, activeIncident.id, "recovery_observed", now, {
        consecutiveSuccesses: evaluation.nextSnapshot.consecutiveSuccesses,
        recoveryThreshold: monitor.recoveryThreshold,
      });
    }

    await client.query(
      `UPDATE monitors
      SET state = $2,
          consecutive_failures = $3,
          consecutive_successes = $4,
          next_sequence = next_sequence + 1,
          last_evaluated_sequence = $5,
          last_evaluated_check_at = $6,
          active_incident_id = $7,
          last_heartbeat_at = $6,
          next_heartbeat_deadline = $6::timestamptz +
            (interval_seconds + grace_period_seconds) * interval '1 second',
          updated_at = $6
      WHERE id = $1`,
      [
        monitor.id,
        evaluation.nextSnapshot.state,
        String(evaluation.nextSnapshot.consecutiveFailures),
        String(evaluation.nextSnapshot.consecutiveSuccesses),
        String(sequence),
        now,
        activeIncident?.id ?? null,
      ],
    );

    return { checkId, receivedAt: now.toISOString(), deduplicated: false };
  });
}
