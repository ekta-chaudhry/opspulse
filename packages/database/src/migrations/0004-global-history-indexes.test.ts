import { expect, it } from "vitest";
import { globalHistoryIndexesMigrationSql } from "./0004-global-history-indexes.js";

it("indexes global check and incident history orders", () => {
  expect(globalHistoryIndexesMigrationSql).toContain(
    "check_requests (scheduled_at DESC, id DESC)",
  );
  expect(globalHistoryIndexesMigrationSql).toContain(
    "incidents (started_at DESC, id DESC)",
  );
});
