import type { MonitorKind } from "@opspulse/contracts";
import { isMonitorKind } from "@opspulse/domain";

export { createDatabasePool } from "./client.js";
export type {
  DatabasePoolConfig,
  QueryClient,
  QueryResult,
} from "./client.js";
export {
  CheckCompletionConflictError,
  completeHttpCheck,
} from "./evaluate-monitor.js";
export type {
  CompleteHttpCheckResult,
  HttpCheckOutcome,
} from "./evaluate-monitor.js";
export { listIncidents, listMonitorChecks } from "./history.js";
export type { HistoryLimit, IncidentHistoryFilter } from "./history.js";
export { MIGRATIONS, MIGRATION_LOCK_KEY, runMigrations } from "./migrations.js";
export type { Migration, MigrationClient } from "./migrations.js";
export { createHttpMonitor, getHttpMonitor } from "./monitors.js";
export {
  pgInt8ToSafeInteger,
  pgTimestampToIso,
  toCheckHistoryItem,
  toCheckRequest,
  toIncident,
  toIncidentSummary,
  toPrivateHttpMonitor,
} from "./rows.js";
export { claimDueHttpCheck } from "./scheduling.js";
export type { HttpCheckWorkItem } from "./scheduling.js";
export { withTransaction } from "./transaction.js";
export type {
  TransactionClient,
  TransactionPool,
  TransactionQueryResult,
} from "./transaction.js";

export type StoredMonitor = { id: string; kind: MonitorKind };

export const isStoredMonitor = (value: unknown): value is StoredMonitor => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { id?: unknown; kind?: unknown };
  return typeof candidate.id === "string" &&
    typeof candidate.kind === "string" &&
    isMonitorKind(candidate.kind);
};
