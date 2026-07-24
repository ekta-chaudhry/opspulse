import { Pool, type PoolConfig } from "pg";

export type QueryResult = {
  rows: unknown[];
};

export interface QueryClient {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
}

export type DatabasePoolConfig = {
  connectionString: string;
  maxConnections?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
  ssl?: PoolConfig["ssl"];
};

const DEFAULT_MAX_CONNECTIONS = 10;

export function createDatabasePool(config: DatabasePoolConfig): Pool {
  const max = config.maxConnections ?? DEFAULT_MAX_CONNECTIONS;
  if (!Number.isInteger(max) || max <= 0) {
    throw new Error("maxConnections must be a positive integer");
  }

  return new Pool({
    connectionString: config.connectionString,
    max,
    ...(config.idleTimeoutMillis === undefined
      ? {}
      : { idleTimeoutMillis: config.idleTimeoutMillis }),
    ...(config.connectionTimeoutMillis === undefined
      ? {}
      : { connectionTimeoutMillis: config.connectionTimeoutMillis }),
    ...(config.ssl === undefined ? {} : { ssl: config.ssl }),
  });
}
