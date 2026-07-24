export type WorkerConfig = {
  databaseUrl: string;
  pollIntervalMs: number;
};

function pollInterval(value: string | undefined): number {
  if (value === undefined) return 500;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 60_000) {
    throw new Error("POLL_INTERVAL_MS must be an integer from 1 to 60000");
  }
  return parsed;
}

export function parseWorkerConfig(env: NodeJS.ProcessEnv): WorkerConfig {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error("DATABASE_URL is required");
  }
  return {
    databaseUrl,
    pollIntervalMs: pollInterval(env.POLL_INTERVAL_MS),
  };
}
