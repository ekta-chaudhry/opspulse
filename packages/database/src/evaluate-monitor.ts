import {
  CompletedCheckHistoryItemSchema,
  CheckHistoryItemSchema,
  FailureCauseSchema,
  IdSchema,
  type CompletedCheckHistoryItem,
  type CheckHistoryItem,
  type FailureCause,
  type IncidentSummary,
} from "@opspulse/contracts";
import { evaluateMonitorResult } from "@opspulse/domain";
import { createIncidentNotificationDeliveries } from "./notification-deliveries.js";
import { HTTP_MONITOR_COLUMNS } from "./monitors.js";
import {
  toCheckHistoryItem,
  toCheckRequest,
  toIncidentSummary,
  toPrivateHttpMonitor,
} from "./rows.js";
import {
  withTransaction,
  type TransactionClient,
  type TransactionPool,
} from "./transaction.js";

export type HttpCheckOutcome =
  | {
    result: "success";
    httpStatus: number | null;
    latencyMs: number | null;
    cause: null;
  }
  | {
    result: "failure" | "timeout";
    httpStatus: number | null;
    latencyMs: number | null;
    cause: FailureCause;
  };

export type CompleteHttpCheckResult = {
  historyItem: CheckHistoryItem;
  incident: IncidentSummary | null;
};

export class CheckCompletionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CheckCompletionConflictError";
  }
}

function validateNullableInteger(
  value: number | null,
  name: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): void {
  if (
    value !== null &&
    (!Number.isSafeInteger(value) || value < minimum || value > maximum)
  ) {
    throw new TypeError(
      `${name} must be null or a safe integer from ${String(minimum)} to ${String(maximum)}`,
    );
  }
}

function validateOutcome(outcome: HttpCheckOutcome): HttpCheckOutcome {
  validateNullableInteger(outcome.httpStatus, "httpStatus", 100, 599);
  validateNullableInteger(outcome.latencyMs, "latencyMs", 0);
  if (outcome.result === "success") {
    return outcome;
  }
  const cause = FailureCauseSchema.parse(outcome.cause);
  if (cause.category === "http_status" && cause.httpStatus !== outcome.httpStatus) {
    throw new TypeError("httpStatus must match an http_status failure cause");
  }
  return { ...outcome, cause };
}

async function loadCompletedHistory(
  client: TransactionClient,
  requestId: string,
): Promise<CompletedCheckHistoryItem> {
  const result = await client.query(
    `SELECT
      cr.id AS request_id,
      cr.monitor_id AS request_monitor_id,
      cr.generation AS request_generation,
      cr.sequence AS request_sequence,
      cr.source AS request_source,
      cr.status AS request_status,
      cr.scheduled_at AS request_scheduled_at,
      cr.terminal_at AS request_terminal_at,
      cr.created_at AS request_created_at,
      r.id AS run_id,
      r.result AS run_result,
      r.http_status AS run_http_status,
      r.latency_ms AS run_latency_ms,
      r.cause AS run_cause,
      r.completed_at AS run_completed_at,
      r.created_at AS run_created_at,
      r.evaluated_at AS run_evaluated_at
    FROM check_requests cr
    JOIN check_runs r ON r.request_id = cr.id
    WHERE cr.id = $1`,
    [requestId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("completed HTTP check has no persisted run");
  }
  const historyItem = toCheckHistoryItem(row);
  if (historyItem.request.status !== "completed") {
    throw new Error("completed HTTP check projection is not completed");
  }
  return CompletedCheckHistoryItemSchema.parse(historyItem);
}

async function loadActiveIncident(
  client: TransactionClient,
  requestId: string,
): Promise<IncidentSummary | null> {
  const result = await client.query(
    `SELECT i.id, i.status, i.started_at, i.latest_cause
    FROM incidents i
    JOIN monitors m ON m.active_incident_id = i.id
    JOIN check_requests cr ON cr.monitor_id = m.id
    WHERE cr.id = $1 AND i.status = 'open'`,
    [requestId],
  );
  const row = result.rows[0];
  return row === undefined ? null : toIncidentSummary(row);
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

const increment = (value: number): number =>
  value === Number.MAX_SAFE_INTEGER ? value : value + 1;

export async function completeHttpCheck(
  pool: TransactionPool,
  requestId: string,
  outcome: HttpCheckOutcome,
  now: Date = new Date(),
): Promise<CompleteHttpCheckResult> {
  const id = IdSchema.parse(requestId);
  return withTransaction(pool, async (client) => {
    const lockedMonitor = await client.query(
      `SELECT ${HTTP_MONITOR_COLUMNS}
      FROM monitors m
      LEFT JOIN incidents i ON i.id = m.active_incident_id
      WHERE m.id = (
        SELECT cr.monitor_id FROM check_requests cr WHERE cr.id = $1
      ) AND m.kind = 'http'
      FOR UPDATE OF m`,
      [id],
    );
    const monitorRow = lockedMonitor.rows[0];
    const lockedRequest = await client.query(
      `SELECT * FROM check_requests
      WHERE id = $1
      FOR UPDATE`,
      [id],
    );
    const requestRow = lockedRequest.rows[0];
    if (requestRow === undefined) {
      throw new CheckCompletionConflictError("HTTP check request does not exist");
    }
    const request = toCheckRequest(requestRow);
    if (request.status === "completed") {
      return {
        historyItem: await loadCompletedHistory(client, request.id),
        incident: await loadActiveIncident(client, request.id),
      };
    }
    if (request.status === "cancelled-internal") {
      const checkedOutcome = validateOutcome(outcome);
      const insertedRun = await client.query(
        `INSERT INTO check_runs (
          request_id, monitor_id, generation, sequence, result, http_status,
          latency_ms, cause, completed_at, evaluated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, NULL)
        RETURNING id`,
        [
          null,
          request.monitorId,
          String(request.generation),
          String(request.sequence),
          checkedOutcome.result,
          checkedOutcome.httpStatus,
          checkedOutcome.latencyMs === null ? null : String(checkedOutcome.latencyMs),
          checkedOutcome.cause === null ? null : JSON.stringify(checkedOutcome.cause),
          now,
        ],
      );
      if (insertedRun.rows[0] === undefined) throw new Error("late check run insert returned no row");
      return {
        historyItem: CheckHistoryItemSchema.parse({
          request,
          run: null,
          monitoringError: {
            safeSummary: "Check cancelled after monitor lifecycle changed",
            recordedAt: request.terminalAt,
          },
        }),
        incident: await loadActiveIncident(client, request.id),
      };
    }
    if (request.source !== "http_schedule") {
      throw new CheckCompletionConflictError("check request is not an HTTP schedule request");
    }
    if (monitorRow === undefined) {
      throw new CheckCompletionConflictError("HTTP check monitor does not exist");
    }
    const monitor = toPrivateHttpMonitor(monitorRow);
    if (
      monitor.lifecycle !== "active" ||
      request.generation !== monitor.generation ||
      request.sequence !== monitor.lastEvaluatedSequence + 1 ||
      request.sequence >= monitor.nextSequence
    ) {
      throw new CheckCompletionConflictError(
        "HTTP check request no longer matches the monitor evaluation sequence",
      );
    }

    const checkedOutcome = validateOutcome(outcome);
    const evaluation = evaluateMonitorResult(
      {
        state: monitor.state,
        failureThreshold: monitor.failureThreshold,
        recoveryThreshold: monitor.recoveryThreshold,
        consecutiveFailures: monitor.consecutiveFailures,
        consecutiveSuccesses: monitor.consecutiveSuccesses,
        hasOpenIncident: monitor.activeIncident !== null,
      },
      checkedOutcome,
    );

    const insertedRun = await client.query(
      `INSERT INTO check_runs (
        request_id, monitor_id, generation, sequence, result, http_status,
        latency_ms, cause, completed_at, evaluated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $9)
      RETURNING id`,
      [
        request.id,
        monitor.id,
        String(request.generation),
        String(request.sequence),
        checkedOutcome.result,
        checkedOutcome.httpStatus,
        checkedOutcome.latencyMs === null ? null : String(checkedOutcome.latencyMs),
        checkedOutcome.cause === null ? null : JSON.stringify(checkedOutcome.cause),
        now,
      ],
    );
    if (insertedRun.rows[0] === undefined) throw new Error("check run insert returned no row");
    await client.query(
      `UPDATE check_requests
      SET status = 'completed', terminal_at = $2
      WHERE id = $1`,
      [request.id, now],
    );

    let activeIncident = monitor.activeIncident;
    const transition = evaluation.transition;
    if (transition.type === "incident.open") {
      const insertedIncident = await client.query(
        `INSERT INTO incidents (
          monitor_id, monitor_name, started_at, opening_cause, latest_cause
        ) VALUES ($1, $2, $3, $4::jsonb, $4::jsonb)
        RETURNING id, status, started_at, latest_cause`,
        [monitor.id, monitor.name, now, JSON.stringify(transition.cause)],
      );
      const incidentRow = insertedIncident.rows[0];
      if (incidentRow === undefined) throw new Error("incident insert returned no row");
      activeIncident = toIncidentSummary(incidentRow);
      const eventId = await appendIncidentEvent(client, activeIncident.id, "opened", now, {
        cause: transition.cause,
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
          cause: transition.cause,
          incident: {
            id: activeIncident.id,
            startedAt: activeIncident.startedAt,
          },
        },
      });
    } else if (transition.type === "incident.observe") {
      if (activeIncident === null) throw new Error("incident observation requires an incident");
      const previousCause = activeIncident.latestCause;
      const updatedIncident = await client.query(
        `UPDATE incidents
        SET latest_cause = $2::jsonb
        WHERE id = $1 AND status = 'open'
        RETURNING id, status, started_at, latest_cause`,
        [activeIncident.id, JSON.stringify(transition.cause)],
      );
      const incidentRow = updatedIncident.rows[0];
      if (incidentRow === undefined) throw new Error("open incident update returned no row");
      activeIncident = toIncidentSummary(incidentRow);
      await appendIncidentEvent(client, activeIncident.id, "failure_observed", now, {
        previousCause,
        nextCause: transition.cause,
      });
    } else if (transition.type === "incident.resolve") {
      if (activeIncident === null) throw new Error("incident resolution requires an incident");
      const incidentId = activeIncident.id;
      await appendIncidentEvent(client, incidentId, "recovery_observed", now, {
        consecutiveSuccesses: increment(monitor.consecutiveSuccesses),
        recoveryThreshold: monitor.recoveryThreshold,
      });
      const resolved = await client.query(
        `UPDATE incidents
        SET status = 'resolved', resolved_at = $2, resolution_reason = 'recovered'
        WHERE id = $1 AND status = 'open'`,
        [incidentId, now],
      );
      if (resolved.rows.length !== 0) {
        throw new Error("incident resolution update must not return rows");
      }
      const eventId = await appendIncidentEvent(client, incidentId, "resolved", now, {
        reason: transition.reason,
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
          resolution: transition.reason,
          incident: {
            id: incidentId,
            startedAt: activeIncident.startedAt,
            resolvedAt: now.toISOString(),
          },
        },
      });
      activeIncident = null;
    } else if (checkedOutcome.result === "success" && activeIncident !== null) {
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
          last_evaluated_sequence = $5,
          last_evaluated_check_at = $6,
          active_incident_id = $7,
          updated_at = $6
      WHERE id = $1`,
      [
        monitor.id,
        evaluation.nextSnapshot.state,
        String(evaluation.nextSnapshot.consecutiveFailures),
        String(evaluation.nextSnapshot.consecutiveSuccesses),
        String(request.sequence),
        now,
        activeIncident?.id ?? null,
      ],
    );

    return {
      historyItem: await loadCompletedHistory(client, request.id),
      incident: activeIncident,
    };
  });
}
