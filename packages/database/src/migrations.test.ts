import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import {
  MIGRATIONS,
  MIGRATION_LOCK_KEY,
  runMigrations,
  type MigrationClient,
} from "./migrations.js";

type QueryCall = { text: string; values: unknown[] | undefined };

const verticalSliceMigration = MIGRATIONS[0];
if (verticalSliceMigration === undefined) {
  throw new Error("Expected the vertical slice migration");
}
const checkRequestLeasesMigration = MIGRATIONS[1];
if (checkRequestLeasesMigration === undefined) {
  throw new Error("Expected the check request leases migration");
}

class FakeMigrationClient implements MigrationClient {
  readonly calls: QueryCall[] = [];
  released = false;
  migrationTablePresent = false;
  appliedRows: Array<{ id: string; checksum: string }> = [];
  failOnText: string | undefined;

  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }> {
    this.calls.push({ text, values });
    if (text === this.failOnText) return Promise.reject(new Error("migration SQL failed"));
    if (text.includes("to_regclass")) {
      return Promise.resolve({
        rows: [{ table_name: this.migrationTablePresent ? "opspulse_migrations" : null }],
      });
    }
    if (text.includes("SELECT id, checksum")) {
      return Promise.resolve({ rows: this.appliedRows });
    }
    return Promise.resolve({ rows: [] });
  }

  release(): void {
    this.released = true;
  }
}

const poolFor = (client: FakeMigrationClient) => ({
  connect(): Promise<FakeMigrationClient> {
    return Promise.resolve(client);
  },
});

it("defines ordered migrations with content-derived SHA-256 checksums", () => {
  expect(MIGRATIONS.map(({ id }) => id)).toEqual([
    "0001-vertical-slice",
    "0002-check-request-leases",
    "0003-monitor-list-index",
    "0004-global-history-indexes",
    "0005-notification-channels",
    "0006-notification-deliveries",
    "0007-heartbeat-tokens",
  ]);
  for (const migration of MIGRATIONS) {
    expect(migration.checksum).toBe(
      createHash("sha256").update(migration.sql).digest("hex"),
    );
  }
});

it("locks, applies, and records pending migrations in one transaction", async () => {
  const client = new FakeMigrationClient();

  await runMigrations(poolFor(client));

  expect(client.calls[0]).toEqual({ text: "BEGIN", values: undefined });
  expect(client.calls[1]).toEqual({
    text: "SELECT pg_advisory_xact_lock($1)",
    values: [MIGRATION_LOCK_KEY],
  });
  const migrationSqlIndex = client.calls.findIndex(
    ({ text }) => text === verticalSliceMigration.sql,
  );
  const insertIndex = client.calls.findIndex(({ text }) => text.includes("INSERT INTO opspulse_migrations"));
  expect(migrationSqlIndex).toBeGreaterThan(0);
  expect(insertIndex).toBeGreaterThan(migrationSqlIndex);
  expect(client.calls[insertIndex]?.values).toEqual([
    verticalSliceMigration.id,
    verticalSliceMigration.checksum,
  ]);
  expect(client.calls.some(({ text }) => text === checkRequestLeasesMigration.sql)).toBe(true);
  expect(client.calls.at(-1)).toEqual({ text: "COMMIT", values: undefined });
  expect(client.released).toBe(true);
});

it("does not reapply migrations with matching recorded checksums", async () => {
  const client = new FakeMigrationClient();
  client.migrationTablePresent = true;
  client.appliedRows = MIGRATIONS.map(({ id, checksum }) => ({ id, checksum }));

  await runMigrations(poolFor(client));

  expect(client.calls.some(({ text }) => text === verticalSliceMigration.sql)).toBe(false);
  expect(client.calls.some(({ text }) => text.includes("INSERT INTO opspulse_migrations"))).toBe(
    false,
  );
  expect(client.calls.at(-1)?.text).toBe("COMMIT");
});

it("rejects checksum drift before applying migrations", async () => {
  const client = new FakeMigrationClient();
  client.migrationTablePresent = true;
  client.appliedRows = [{ id: verticalSliceMigration.id, checksum: "changed" }];

  await expect(runMigrations(poolFor(client))).rejects.toThrow(
    "Checksum mismatch for migration 0001-vertical-slice",
  );

  expect(client.calls.some(({ text }) => text === verticalSliceMigration.sql)).toBe(false);
  expect(client.calls.at(-1)?.text).toBe("ROLLBACK");
  expect(client.released).toBe(true);
});

it("rolls back the full migration set when migration SQL fails", async () => {
  const client = new FakeMigrationClient();
  client.failOnText = verticalSliceMigration.sql;

  await expect(runMigrations(poolFor(client))).rejects.toThrow("migration SQL failed");

  expect(client.calls.at(-1)?.text).toBe("ROLLBACK");
  expect(client.calls.some(({ text }) => text.includes("INSERT INTO opspulse_migrations"))).toBe(
    false,
  );
  expect(client.released).toBe(true);
});
