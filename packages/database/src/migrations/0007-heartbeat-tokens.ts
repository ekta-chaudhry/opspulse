export const heartbeatTokensMigrationSql = `
ALTER TABLE monitors
  ADD COLUMN heartbeat_token_hash TEXT,
  ADD COLUMN heartbeat_token_rotated_at TIMESTAMPTZ;

ALTER TABLE monitors
  DROP CONSTRAINT "monitors_subtype_check";

ALTER TABLE monitors
  ADD CONSTRAINT "monitors_heartbeat_token_hash_check" CHECK (
    heartbeat_token_hash IS NULL OR heartbeat_token_hash ~ '^[0-9a-f]{64}$'
  );

ALTER TABLE monitors
  ADD CONSTRAINT "monitors_subtype_check" CHECK (
    (
      kind = 'http' AND
      url IS NOT NULL AND char_length(url) BETWEEN 1 AND 2048 AND
      method IS NOT NULL AND method IN ('GET', 'HEAD') AND
      timeout_seconds IS NOT NULL AND timeout_seconds BETWEEN 1 AND 30 AND
      accepted_status_min IS NOT NULL AND accepted_status_max IS NOT NULL AND
      headers IS NOT NULL AND jsonb_typeof(headers) = 'array' AND
      grace_period_seconds IS NULL AND
      last_heartbeat_at IS NULL AND
      next_heartbeat_deadline IS NULL AND
      heartbeat_token_hash IS NULL AND
      heartbeat_token_rotated_at IS NULL
    ) OR
    (
      kind = 'heartbeat' AND
      url IS NULL AND method IS NULL AND timeout_seconds IS NULL AND
      accepted_status_min IS NULL AND accepted_status_max IS NULL AND
      headers IS NULL AND next_check_at IS NULL AND
      grace_period_seconds IS NOT NULL AND grace_period_seconds BETWEEN 0 AND 86400 AND
      heartbeat_token_hash IS NOT NULL AND
      heartbeat_token_rotated_at IS NOT NULL
    )
  );

CREATE UNIQUE INDEX monitors_heartbeat_token_hash_key
  ON monitors (heartbeat_token_hash)
  WHERE kind = 'heartbeat' AND lifecycle <> 'archived';
`;
