import { describe, expect, it, vi } from "vitest";

const createDatabasePool = vi.fn();

vi.mock("./client.js", () => ({ createDatabasePool }));

describe("migration CLI", () => {
  it("is safe to import without opening a database connection", async () => {
    await import("./migrate.js");

    expect(createDatabasePool).not.toHaveBeenCalled();
  });

  it("closes the pool when a migration fails", async () => {
    const end = vi.fn(() => Promise.resolve());
    const pool = { connect: vi.fn(), end };
    createDatabasePool.mockReturnValue(pool);
    const failure = new Error("postgresql://owner:secret@private-db/opspulse");
    const runMigrations = vi.fn(() => Promise.reject(failure));
    const { runMigrationCli } = await import("./migrate.js");

    await expect(
      runMigrationCli(
        { DATABASE_URL: "postgresql://owner:secret@private-db/opspulse" },
        { createPool: createDatabasePool, runMigrations },
      ),
    ).rejects.toBe(failure);

    expect(runMigrations).toHaveBeenCalledWith(pool);
    expect(end).toHaveBeenCalledOnce();
  });
});
