import type { MonitorKind } from "@opspulse/contracts";
import { isMonitorKind } from "@opspulse/domain";

export type StoredMonitor = { id: string; kind: MonitorKind };

export const isStoredMonitor = (value: unknown): value is StoredMonitor => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { id?: unknown; kind?: unknown };
  return typeof candidate.id === "string" &&
    typeof candidate.kind === "string" &&
    isMonitorKind(candidate.kind);
};
