import { pathToFileURL } from "node:url";
import { createDatabasePool, type DatabasePoolConfig } from "./client.js";
import { runMigrations } from "./migrations.js";
import type { TransactionPool } from "./transaction.js";

type MigrationPool = TransactionPool & {
  end(): Promise<void>;
};

export type MigrationCliDependencies = {
  createPool(config: DatabasePoolConfig): MigrationPool;
  runMigrations(pool: TransactionPool): Promise<void>;
};

const defaultDependencies: MigrationCliDependencies = {
  createPool: createDatabasePool,
  runMigrations,
};

function databaseUrl(env: NodeJS.ProcessEnv): string {
  const value = env.DATABASE_URL?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error("DATABASE_URL is required");
  }
  return value;
}

export async function runMigrationCli(
  env: NodeJS.ProcessEnv = process.env,
  dependencies: MigrationCliDependencies = defaultDependencies,
): Promise<void> {
  const pool = dependencies.createPool({ connectionString: databaseUrl(env) });
  try {
    await dependencies.runMigrations(pool);
  } finally {
    await pool.end();
  }
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  void runMigrationCli()
    .then(() => {
      console.log(JSON.stringify({ event: "migrations_completed" }));
    })
    .catch(() => {
      console.error(JSON.stringify({ event: "migrations_failed", category: "internal" }));
      process.exitCode = 1;
    });
}
