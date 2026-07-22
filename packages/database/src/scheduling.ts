import type { CheckRequest, PrivateHttpMonitor } from "@opspulse/contracts";
import { HTTP_MONITOR_COLUMNS } from "./monitors.js";
import { toCheckRequest, toPrivateHttpMonitor } from "./rows.js";
import { withTransaction, type TransactionPool } from "./transaction.js";

export type HttpCheckWorkItem = {
  request: CheckRequest & { status: "pending" };
  monitor: PrivateHttpMonitor;
};

export async function claimDueHttpCheck(
  pool: TransactionPool,
  now: Date = new Date(),
): Promise<HttpCheckWorkItem | null> {
  return withTransaction(pool, async (client) => {
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
          next_check_at = $2 + interval_seconds * interval '1 second',
          updated_at = $2
      WHERE id = $1`,
      [monitor.id, now],
    );
    const inserted = await client.query(
      `INSERT INTO check_requests (
        monitor_id, generation, sequence, source, scheduled_at
      ) VALUES ($1, $2, $3, 'http_schedule', $4)
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
