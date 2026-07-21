import type { MonitorKind } from "@opspulse/contracts";

export const isMonitorKind = (value: string): value is MonitorKind =>
  value === "http" || value === "heartbeat";
