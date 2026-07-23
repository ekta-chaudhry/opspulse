export type ApiConfig = {
  databaseUrl: string;
  host: string;
  port: number;
};

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function port(value: string | undefined): number {
  if (value === undefined) return 3000;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error("PORT must be an integer from 1 to 65535");
  }
  return parsed;
}

export function parseApiConfig(env: NodeJS.ProcessEnv): ApiConfig {
  return {
    databaseUrl: required(env, "DATABASE_URL"),
    host: env.HOST?.trim() || "0.0.0.0",
    port: port(env.PORT),
  };
}
