import { afterEach, expect, it } from "vitest";
import { createDatabasePool } from "./client.js";
import type { QueryClient } from "./client.js";
import type { TransactionPool } from "./transaction.js";

const pools: Array<ReturnType<typeof createDatabasePool>> = [];
const originalDatabaseUrl = process.env.DATABASE_URL;

afterEach(async () => {
  await Promise.all(pools.splice(0).map(async (pool) => pool.end()));
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
});

it("creates a bounded pool from explicit connection settings", () => {
  const pool = createDatabasePool({
    connectionString: "postgresql://explicit.example/opspulse",
    maxConnections: 6,
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 3_000,
    ssl: true,
  });
  pools.push(pool);
  const queryClient: QueryClient = pool;
  const transactionPool: TransactionPool = pool;

  expect(queryClient).toBe(pool);
  expect(transactionPool).toBe(pool);
  expect(pool.options).toMatchObject({
    connectionString: "postgresql://explicit.example/opspulse",
    max: 6,
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 3_000,
    ssl: true,
  });
});

it("uses a finite default pool bound without consulting DATABASE_URL", () => {
  process.env.DATABASE_URL = "postgresql://environment.example/wrong";

  const pool = createDatabasePool({
    connectionString: "postgresql://explicit.example/right",
  });
  pools.push(pool);

  expect(pool.options.connectionString).toBe("postgresql://explicit.example/right");
  expect(pool.options.max).toBe(10);
});

it.each([0, -1, 1.5])("rejects an invalid max connection count of %s", (maxConnections) => {
  expect(() => createDatabasePool({
    connectionString: "postgresql://explicit.example/opspulse",
    maxConnections,
  })).toThrow("maxConnections must be a positive integer");
});
