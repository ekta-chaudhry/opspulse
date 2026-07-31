export const notificationDeliveriesMigrationSql = `
CREATE TABLE notification_deliveries (
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  incident_event_id UUID NOT NULL,
  channel_id UUID NOT NULL,
  monitor_id UUID NOT NULL,
  status TEXT DEFAULT 'queued' NOT NULL,
  deduplication_key TEXT NOT NULL,
  payload JSONB NOT NULL,
  webhook_url TEXT NOT NULL,
  signing_secret TEXT NOT NULL,
  replay_of_delivery_id UUID,
  attempt_count INTEGER DEFAULT 0 NOT NULL,
  next_attempt_at TIMESTAMPTZ,
  last_response_status INTEGER,
  last_safe_error TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY (id),
  CONSTRAINT "notification_deliveries_incident_event_id_fkey" FOREIGN KEY (incident_event_id)
    REFERENCES incident_events(id) ON DELETE RESTRICT,
  CONSTRAINT "notification_deliveries_channel_id_fkey" FOREIGN KEY (channel_id)
    REFERENCES notification_channels(id) ON DELETE RESTRICT,
  CONSTRAINT "notification_deliveries_monitor_id_fkey" FOREIGN KEY (monitor_id)
    REFERENCES monitors(id) ON DELETE RESTRICT,
  CONSTRAINT "notification_deliveries_replay_of_delivery_id_fkey" FOREIGN KEY (replay_of_delivery_id)
    REFERENCES notification_deliveries(id) ON DELETE RESTRICT,
  CONSTRAINT "notification_deliveries_deduplication_key_key" UNIQUE (deduplication_key),
  CONSTRAINT "notification_deliveries_status_check" CHECK (
    status IN ('queued', 'retrying', 'delivered', 'failed')
  ),
  CONSTRAINT "notification_deliveries_deduplication_key_check" CHECK (
    char_length(deduplication_key) BETWEEN 1 AND 512
  ),
  CONSTRAINT "notification_deliveries_payload_check" CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT "notification_deliveries_url_check" CHECK (
    char_length(webhook_url) BETWEEN 1 AND 2048 AND webhook_url ~ '^https?://'
  ),
  CONSTRAINT "notification_deliveries_signing_secret_check" CHECK (
    char_length(signing_secret) BETWEEN 32 AND 1024
  ),
  CONSTRAINT "notification_deliveries_attempt_count_check" CHECK (
    attempt_count BETWEEN 0 AND 6
  ),
  CONSTRAINT "notification_deliveries_response_status_check" CHECK (
    last_response_status IS NULL OR last_response_status BETWEEN 100 AND 599
  ),
  CONSTRAINT "notification_deliveries_safe_error_check" CHECK (
    last_safe_error IS NULL OR char_length(btrim(last_safe_error)) BETWEEN 1 AND 500
  ),
  CONSTRAINT "notification_deliveries_replay_not_self_check" CHECK (
    replay_of_delivery_id IS NULL OR replay_of_delivery_id <> id
  ),
  CONSTRAINT "notification_deliveries_status_shape_check" CHECK (
    (
      status = 'queued' AND attempt_count = 0 AND next_attempt_at IS NOT NULL AND
      last_response_status IS NULL AND last_safe_error IS NULL
    ) OR (
      status = 'retrying' AND attempt_count BETWEEN 1 AND 5 AND next_attempt_at IS NOT NULL AND
      (last_response_status IS NOT NULL OR last_safe_error IS NOT NULL)
    ) OR (
      status = 'delivered' AND attempt_count BETWEEN 1 AND 6 AND next_attempt_at IS NULL AND
      last_response_status BETWEEN 200 AND 299 AND last_safe_error IS NULL
    ) OR (
      status = 'failed' AND attempt_count BETWEEN 1 AND 6 AND next_attempt_at IS NULL AND
      (last_response_status IS NOT NULL OR last_safe_error IS NOT NULL)
    )
  ),
  CONSTRAINT "notification_deliveries_updated_at_check" CHECK (updated_at >= created_at)
);

CREATE INDEX notification_deliveries_due_idx
  ON notification_deliveries (next_attempt_at, id) WHERE status IN ('queued', 'retrying');
CREATE INDEX notification_deliveries_monitor_history_idx
  ON notification_deliveries (monitor_id, created_at DESC, id DESC);
CREATE INDEX notification_deliveries_channel_history_idx
  ON notification_deliveries (channel_id, created_at DESC, id DESC);

CREATE TABLE notification_attempts (
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  delivery_id UUID NOT NULL,
  attempt_number INTEGER NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL,
  outcome TEXT NOT NULL,
  response_status INTEGER,
  safe_error TEXT,
  CONSTRAINT "notification_attempts_pkey" PRIMARY KEY (id),
  CONSTRAINT "notification_attempts_delivery_id_fkey" FOREIGN KEY (delivery_id)
    REFERENCES notification_deliveries(id) ON DELETE RESTRICT,
  CONSTRAINT "notification_attempts_delivery_attempt_key" UNIQUE (delivery_id, attempt_number),
  CONSTRAINT "notification_attempts_attempt_number_check" CHECK (attempt_number BETWEEN 1 AND 6),
  CONSTRAINT "notification_attempts_outcome_check" CHECK (
    outcome IN ('delivered', 'retryable_failure', 'final_failure')
  ),
  CONSTRAINT "notification_attempts_response_status_check" CHECK (
    response_status IS NULL OR response_status BETWEEN 100 AND 599
  ),
  CONSTRAINT "notification_attempts_safe_error_check" CHECK (
    safe_error IS NULL OR char_length(btrim(safe_error)) BETWEEN 1 AND 500
  ),
  CONSTRAINT "notification_attempts_chronology_check" CHECK (completed_at >= started_at),
  CONSTRAINT "notification_attempts_outcome_shape_check" CHECK (
    (outcome = 'delivered' AND response_status BETWEEN 200 AND 299 AND safe_error IS NULL) OR
    (outcome IN ('retryable_failure', 'final_failure') AND
      (response_status IS NOT NULL OR safe_error IS NOT NULL))
  )
);

CREATE INDEX notification_attempts_delivery_idx
  ON notification_attempts (delivery_id, attempt_number);
`;
