import { describe, expect, it } from "vitest";
import { checkRequestLeasesMigrationSql } from "./0002-check-request-leases.js";

describe("check request lease migration", () => {
  it("adds and backfills constrained HTTP request lease metadata", () => {
    expect(checkRequestLeasesMigrationSql).toContain("ADD COLUMN claim_started_at TIMESTAMPTZ");
    expect(checkRequestLeasesMigrationSql).toContain("ADD COLUMN claim_count BIGINT DEFAULT 0 NOT NULL");
    expect(checkRequestLeasesMigrationSql).toContain("UPDATE check_requests");
    expect(checkRequestLeasesMigrationSql).toContain("source = 'http_schedule'");
    expect(checkRequestLeasesMigrationSql).toContain("claim_count >= 1");
    expect(checkRequestLeasesMigrationSql).toContain("claim_started_at >= created_at");
  });

  it("indexes stale pending HTTP leases", () => {
    expect(checkRequestLeasesMigrationSql).toContain(
      "ON check_requests (claim_started_at, id)",
    );
    expect(checkRequestLeasesMigrationSql).toContain("status = 'pending'");
  });
});
