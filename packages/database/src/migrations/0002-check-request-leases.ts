export const checkRequestLeasesMigrationSql = `
ALTER TABLE check_requests
  ADD COLUMN claim_started_at TIMESTAMPTZ,
  ADD COLUMN claim_count BIGINT DEFAULT 0 NOT NULL;

UPDATE check_requests
SET claim_started_at = created_at,
    claim_count = 1
WHERE source = 'http_schedule';

ALTER TABLE check_requests
  ADD CONSTRAINT "check_requests_claim_count_check" CHECK (claim_count >= 0),
  ADD CONSTRAINT "check_requests_http_lease_check" CHECK (
    source <> 'http_schedule' OR (
      claim_started_at IS NOT NULL AND
      claim_started_at >= created_at AND
      claim_count >= 1
    )
  );

CREATE INDEX check_requests_stale_http_lease_idx
  ON check_requests (claim_started_at, id)
  WHERE status = 'pending' AND source = 'http_schedule';
`;
