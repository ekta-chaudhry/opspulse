import type { CheckRequest, PrivateHttpMonitor } from "@opspulse/contracts";
import { HTTP_MONITOR_COLUMNS } from "./monitors.js";
import { toCheckRequest, toPrivateHttpMonitor } from "./rows.js";
import {
  withTransaction,
  type TransactionClient,
  type TransactionPool,
} from "./transaction.js";

export type HttpCheckWorkItem = {
  request: CheckRequest & { status: "pending" };
  monitor: PrivateHttpMonitor;
};

export const HTTP_CHECK_TIMEOUT_MULTIPLIER = 2;
export const HTTP_CHECK_LEASE_GRACE_SECONDS = 60;

async function reclaimStaleHttpCheck(
  client: TransactionClient,
  now: Date,
): Promise<HttpCheckWorkItem | null> {
  const stale = await client.query(
    `SELECT cr.id
    FROM check_requests cr
    JOIN monitors m ON m.id = cr.monitor_id
    WHERE cr.source = 'http_schedule'
      AND cr.status = 'pending'
      AND m.kind = 'http'
      AND m.lifecycle = 'active'
      AND cr.generation = m.generation
      AND cr.sequence = m.last_evaluated_sequence + 1
      AND cr.claim_started_at <= $1::timestamptz - make_interval(
        secs => $2::integer * m.timeout_seconds + $3::integer
      )
    ORDER BY cr.claim_started_at, cr.id
    LIMIT 1
    FOR UPDATE OF cr, m SKIP LOCKED`,
    [now, HTTP_CHECK_TIMEOUT_MULTIPLIER, HTTP_CHECK_LEASE_GRACE_SECONDS],
  );
  const staleRow = stale.rows[0];
  if (
    typeof staleRow !== "object" ||
    staleRow === null ||
    !("id" in staleRow) ||
    typeof staleRow.id !== "string"
  ) {
    return null;
  }

  const refreshed = await client.query(
    `UPDATE check_requests
    SET claim_started_at = $2,
        claim_count = claim_count + 1
    WHERE id = $1
    RETURNING *`,
    [staleRow.id, now],
  );
  const requestRow = refreshed.rows[0];
  if (requestRow === undefined) throw new Error("stale HTTP check lease refresh returned no row");
  const request = toCheckRequest(requestRow);
  if (request.status !== "pending") {
    throw new Error("reclaimed HTTP check request must be pending");
  }

  const selectedMonitor = await client.query(
    `SELECT ${HTTP_MONITOR_COLUMNS}
    FROM monitors m
    LEFT JOIN incidents i ON i.id = m.active_incident_id
    WHERE m.id = $1 AND m.kind = 'http'`,
    [request.monitorId],
  );
  const monitorRow = selectedMonitor.rows[0];
  if (monitorRow === undefined) throw new Error("reclaimed HTTP check monitor does not exist");
  return { request, monitor: toPrivateHttpMonitor(monitorRow) };
}

export async function claimDueHttpCheck(
  pool: TransactionPool,
  now: Date = new Date(),
): Promise<HttpCheckWorkItem | null> {
  return withTransaction(pool, async (client) => {
    const reclaimed = await reclaimStaleHttpCheck(client, now);
    if (reclaimed !== null) return reclaimed;

    const due = await client.query(
      `SELECT ${HTTP_MONITOR_COLUMNS}
      FROM monitors m
      LEFT JOIN incidents i ON i.id = m.active_incident_id
      WHERE m.kind = 'http'
        AND m.lifecycle = 'active'
        AND m.next_check_at <= $1
        AND NOT EXISTS (
          SELECT 1 FROM check_requests cr
          WHERE cr.monitor_id = m.id AND cr.status = 'pending'
        )
      ORDER BY m.next_check_at, m.id
      LIMIT 1
      FOR UPDATE OF m SKIP LOCKED`,
      [now],
    );
    const monitorRow = due.rows[0];
    if (monitorRow === undefined) return null;

    const monitor = toPrivateHttpMonitor(monitorRow);
    await client.query(
      `UPDATE monitors
      SET next_sequence = next_sequence + 1,
          next_check_at = $2::timestamptz + interval_seconds * interval '1 second',
          updated_at = $2
      WHERE id = $1`,
      [monitor.id, now],
    );
    const inserted = await client.query(
      `INSERT INTO check_requests (
        monitor_id, generation, sequence, source, scheduled_at, created_at,
        claim_started_at, claim_count
      ) VALUES ($1, $2, $3, 'http_schedule', $4, $4, $4, 1)
      RETURNING *`,
      [
        monitor.id,
        String(monitor.generation),
        String(monitor.nextSequence),
        now,
      ],
    );
    const requestRow = inserted.rows[0];
    if (requestRow === undefined) throw new Error("check request insert returned no row");
    const request = toCheckRequest(requestRow);
    if (request.status !== "pending") {
      throw new Error("new HTTP check request must be pending");
    }
    return { request, monitor };
  });
}
