import { expect, it } from "vitest";
import { monitorListIndexMigrationSql } from "./0003-monitor-list-index.js";

it("indexes the monitor list keyset order", () => {
  expect(monitorListIndexMigrationSql).toContain(
    "CREATE INDEX monitors_history_idx ON monitors (created_at DESC, id DESC)",
  );
});
