import { createHash } from "node:crypto";
import { verticalSliceMigrationSql } from "./migrations/0001-vertical-slice.js";
import { checkRequestLeasesMigrationSql } from "./migrations/0002-check-request-leases.js";
import {
  withTransaction,
  type TransactionClient,
  type TransactionPool,
} from "./transaction.js";

export type Migration = {
  id: string;
  sql: string;
  checksum: string;
};

export type MigrationClient = TransactionClient;

export const MIGRATION_LOCK_KEY = 1_330_666_064;

const checksum = (sql: string): string =>
  createHash("sha256").update(sql).digest("hex");

export const MIGRATIONS: readonly Migration[] = [
  {
    id: "0001-vertical-slice",
    sql: verticalSliceMigrationSql,
    checksum: checksum(verticalSliceMigrationSql),
  },
  {
    id: "0002-check-request-leases",
    sql: checkRequestLeasesMigrationSql,
    checksum: checksum(checkRequestLeasesMigrationSql),
  },
];

const createMigrationTableSql = `
CREATE TABLE opspulse_migrations (
  id TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT "opspulse_migrations_pkey" PRIMARY KEY (id),
  CONSTRAINT "opspulse_migrations_checksum_check" CHECK (checksum ~ '^[0-9a-f]{64}$')
)
`;

type AppliedMigration = { id: string; checksum: string };

function parseAppliedMigrations(rows: unknown[]): AppliedMigration[] {
  return rows.map((row) => {
    if (
      typeof row !== "object" ||
      row === null ||
      !("id" in row) ||
      typeof row.id !== "string" ||
      !("checksum" in row) ||
      typeof row.checksum !== "string"
    ) {
      throw new Error("Invalid row in opspulse_migrations");
    }
    return { id: row.id, checksum: row.checksum };
  });
}

function migrationTableExists(rows: unknown[]): boolean {
  const row = rows[0];
  return typeof row === "object" && row !== null &&
    "table_name" in row && row.table_name !== null;
}

export async function runMigrations(pool: TransactionPool): Promise<void> {
  await withTransaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK_KEY]);

    const tableResult = await client.query(
      "SELECT to_regclass('opspulse_migrations') AS table_name",
    );
    if (!migrationTableExists(tableResult.rows)) {
      await client.query(createMigrationTableSql);
    }

    const appliedResult = await client.query(
      "SELECT id, checksum FROM opspulse_migrations ORDER BY id",
    );
    const applied = new Map(
      parseAppliedMigrations(appliedResult.rows).map((migration) => [
        migration.id,
        migration.checksum,
      ]),
    );

    for (const migration of MIGRATIONS) {
      const recordedChecksum = applied.get(migration.id);
      if (recordedChecksum !== undefined) {
        if (recordedChecksum !== migration.checksum) {
          throw new Error(`Checksum mismatch for migration ${migration.id}`);
        }
        continue;
      }

      await client.query(migration.sql);
      await client.query(
        "INSERT INTO opspulse_migrations (id, checksum) VALUES ($1, $2)",
        [migration.id, migration.checksum],
      );
    }
  });
}
