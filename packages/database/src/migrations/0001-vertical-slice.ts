export const verticalSliceMigrationSql = `
CREATE TABLE monitors (
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  state TEXT DEFAULT 'pending' NOT NULL,
  lifecycle TEXT DEFAULT 'active' NOT NULL,
  published BOOLEAN DEFAULT false NOT NULL,
  interval_seconds INTEGER DEFAULT 60 NOT NULL,
  failure_threshold INTEGER DEFAULT 2 NOT NULL,
  recovery_threshold INTEGER DEFAULT 1 NOT NULL,
  consecutive_failures BIGINT DEFAULT 0 NOT NULL,
  consecutive_successes BIGINT DEFAULT 0 NOT NULL,
  generation BIGINT DEFAULT 0 NOT NULL,
  next_sequence BIGINT DEFAULT 1 NOT NULL,
  last_evaluated_sequence BIGINT DEFAULT 0 NOT NULL,
  last_evaluated_check_at TIMESTAMPTZ,
  active_incident_id UUID,
  url TEXT,
  method TEXT,
  timeout_seconds INTEGER,
  accepted_status_min INTEGER,
  accepted_status_max INTEGER,
  headers JSONB,
  next_check_at TIMESTAMPTZ,
  grace_period_seconds INTEGER,
  last_heartbeat_at TIMESTAMPTZ,
  next_heartbeat_deadline TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT "monitors_pkey" PRIMARY KEY (id),
  CONSTRAINT "monitors_kind_check" CHECK (kind IN ('http', 'heartbeat')),
  CONSTRAINT "monitors_name_check" CHECK (
    char_length(btrim(name)) BETWEEN 1 AND 100 AND name = btrim(name)
  ),
  CONSTRAINT "monitors_state_check" CHECK (state IN ('pending', 'up', 'degraded', 'down')),
  CONSTRAINT "monitors_lifecycle_check" CHECK (lifecycle IN ('active', 'paused', 'archived')),
  CONSTRAINT "monitors_interval_seconds_check" CHECK (
    interval_seconds BETWEEN 30 AND 86400
  ),
  CONSTRAINT "monitors_thresholds_check" CHECK (
    failure_threshold BETWEEN 1 AND 10 AND recovery_threshold BETWEEN 1 AND 10
  ),
  CONSTRAINT "monitors_counters_check" CHECK (
    consecutive_failures >= 0 AND consecutive_successes >= 0 AND generation >= 0
  ),
  CONSTRAINT "monitors_sequence_order_check" CHECK (
    next_sequence > 0 AND last_evaluated_sequence >= 0 AND
    next_sequence > last_evaluated_sequence
  ),
  CONSTRAINT "monitors_http_status_range_check" CHECK (
    (accepted_status_min IS NULL AND accepted_status_max IS NULL) OR
    (
      accepted_status_min BETWEEN 100 AND 599 AND
      accepted_status_max BETWEEN 100 AND 599 AND
      accepted_status_min <= accepted_status_max
    )
  ),
  CONSTRAINT "monitors_updated_at_check" CHECK (updated_at >= created_at),
  CONSTRAINT "monitors_subtype_check" CHECK (
    (
      kind = 'http' AND
      url IS NOT NULL AND char_length(url) BETWEEN 1 AND 2048 AND
      method IS NOT NULL AND method IN ('GET', 'HEAD') AND
      timeout_seconds IS NOT NULL AND timeout_seconds BETWEEN 1 AND 30 AND
      accepted_status_min IS NOT NULL AND accepted_status_max IS NOT NULL AND
      headers IS NOT NULL AND jsonb_typeof(headers) = 'array' AND
      grace_period_seconds IS NULL AND
      last_heartbeat_at IS NULL AND
      next_heartbeat_deadline IS NULL
    ) OR
    (
      kind = 'heartbeat' AND
      url IS NULL AND method IS NULL AND timeout_seconds IS NULL AND
      accepted_status_min IS NULL AND accepted_status_max IS NULL AND
      headers IS NULL AND next_check_at IS NULL AND
      grace_period_seconds IS NOT NULL AND grace_period_seconds BETWEEN 0 AND 86400
    )
  )
);

CREATE TABLE check_requests (
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  monitor_id UUID NOT NULL,
  generation BIGINT NOT NULL,
  sequence BIGINT NOT NULL,
  source TEXT NOT NULL,
  status TEXT DEFAULT 'pending' NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  terminal_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT "check_requests_pkey" PRIMARY KEY (id),
  CONSTRAINT "check_requests_monitor_id_fkey" FOREIGN KEY (monitor_id)
    REFERENCES monitors(id) ON DELETE RESTRICT,
  CONSTRAINT "check_requests_monitor_generation_sequence_key"
    UNIQUE (monitor_id, generation, sequence),
  CONSTRAINT "check_requests_generation_sequence_check" CHECK (
    generation >= 0 AND sequence > 0
  ),
  CONSTRAINT "check_requests_source_check" CHECK (
    source IN ('http_schedule', 'heartbeat_ping', 'heartbeat_deadline')
  ),
  CONSTRAINT "check_requests_status_check" CHECK (
    status IN ('pending', 'completed', 'cancelled-internal')
  ),
  CONSTRAINT "check_requests_status_terminal_check" CHECK (
    (status = 'pending' AND terminal_at IS NULL) OR
    (
      status IN ('completed', 'cancelled-internal') AND
      terminal_at IS NOT NULL AND terminal_at >= created_at
    )
  )
);

CREATE UNIQUE INDEX check_requests_one_pending_per_monitor_idx
  ON check_requests (monitor_id) WHERE status = 'pending';
CREATE INDEX check_requests_due_idx
  ON check_requests (scheduled_at, id) WHERE status = 'pending';
CREATE INDEX check_requests_history_idx
  ON check_requests (monitor_id, scheduled_at DESC, id DESC);

CREATE TABLE check_runs (
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  request_id UUID,
  monitor_id UUID NOT NULL,
  generation BIGINT NOT NULL,
  sequence BIGINT NOT NULL,
  result TEXT NOT NULL,
  http_status INTEGER,
  latency_ms BIGINT,
  cause JSONB,
  completed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  evaluated_at TIMESTAMPTZ,
  CONSTRAINT "check_runs_pkey" PRIMARY KEY (id),
  CONSTRAINT "check_runs_request_id_key" UNIQUE (request_id),
  CONSTRAINT "check_runs_request_id_fkey" FOREIGN KEY (request_id)
    REFERENCES check_requests(id) ON DELETE RESTRICT,
  CONSTRAINT "check_runs_monitor_id_fkey" FOREIGN KEY (monitor_id)
    REFERENCES monitors(id) ON DELETE RESTRICT,
  CONSTRAINT "check_runs_generation_sequence_check" CHECK (
    generation >= 0 AND sequence > 0
  ),
  CONSTRAINT "check_runs_result_check" CHECK (result IN ('success', 'failure', 'timeout')),
  CONSTRAINT "check_runs_http_status_check" CHECK (
    http_status IS NULL OR http_status BETWEEN 100 AND 599
  ),
  CONSTRAINT "check_runs_latency_check" CHECK (latency_ms IS NULL OR latency_ms >= 0),
  CONSTRAINT "check_runs_result_cause_check" CHECK (
    (result = 'success' AND cause IS NULL) OR
    (result IN ('failure', 'timeout') AND cause IS NOT NULL)
  ),
  CONSTRAINT "check_runs_cause_shape_check" CHECK (
    cause IS NULL OR (
      jsonb_typeof(cause) = 'object' AND
      cause ?& ARRAY['category', 'code', 'httpStatus', 'safeSummary'] AND
      cause->>'category' IN (
        'http_status', 'timeout', 'dns', 'connection', 'tls', 'network',
        'heartbeat_late', 'unknown'
      ) AND
      jsonb_typeof(cause->'code') IN ('string', 'null') AND
      jsonb_typeof(cause->'safeSummary') = 'string' AND
      CASE
        WHEN cause->>'category' = 'http_status' THEN
          jsonb_typeof(cause->'httpStatus') = 'number' AND
          (cause->>'httpStatus') ~ '^[0-9]+$' AND
          (cause->>'httpStatus')::INTEGER BETWEEN 100 AND 599 AND
          http_status IS NOT NULL AND http_status = (cause->>'httpStatus')::INTEGER
        ELSE cause->'httpStatus' = 'null'::JSONB
      END
    )
  ),
  CONSTRAINT "check_runs_evaluated_at_check" CHECK (
    evaluated_at IS NULL OR evaluated_at >= completed_at
  )
);

CREATE INDEX check_runs_history_idx
  ON check_runs (monitor_id, completed_at DESC, id DESC);

CREATE TABLE incidents (
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  monitor_id UUID NOT NULL,
  monitor_name TEXT NOT NULL,
  status TEXT DEFAULT 'open' NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,
  opening_cause JSONB NOT NULL,
  latest_cause JSONB NOT NULL,
  resolution_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT "incidents_pkey" PRIMARY KEY (id),
  CONSTRAINT "incidents_monitor_id_fkey" FOREIGN KEY (monitor_id)
    REFERENCES monitors(id) ON DELETE RESTRICT,
  CONSTRAINT "incidents_monitor_name_check" CHECK (
    char_length(btrim(monitor_name)) BETWEEN 1 AND 100 AND monitor_name = btrim(monitor_name)
  ),
  CONSTRAINT "incidents_status_check" CHECK (status IN ('open', 'resolved')),
  CONSTRAINT "incidents_causes_check" CHECK (
    jsonb_typeof(opening_cause) = 'object' AND jsonb_typeof(latest_cause) = 'object'
  ),
  CONSTRAINT "incidents_status_times_check" CHECK (
    (
      status = 'open' AND resolved_at IS NULL AND resolution_reason IS NULL
    ) OR
    (
      status = 'resolved' AND resolved_at IS NOT NULL AND resolved_at >= started_at AND
      resolution_reason IS NOT NULL AND
      resolution_reason IN ('recovered', 'monitor_archived')
    )
  )
);

CREATE UNIQUE INDEX incidents_one_open_per_monitor_idx
  ON incidents (monitor_id) WHERE status = 'open';
CREATE INDEX incidents_history_idx
  ON incidents (monitor_id, started_at DESC, id DESC);

CREATE TABLE incident_events (
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  incident_id UUID NOT NULL,
  type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  details JSONB NOT NULL,
  CONSTRAINT "incident_events_pkey" PRIMARY KEY (id),
  CONSTRAINT "incident_events_incident_id_fkey" FOREIGN KEY (incident_id)
    REFERENCES incidents(id) ON DELETE CASCADE,
  CONSTRAINT "incident_events_type_check" CHECK (
    type IN (
      'opened', 'failure_observed', 'notification_queued',
      'recovery_observed', 'resolved'
    )
  ),
  CONSTRAINT "incident_events_details_check" CHECK (jsonb_typeof(details) = 'object')
);

CREATE INDEX incident_events_timeline_idx
  ON incident_events (incident_id, occurred_at, id);

ALTER TABLE monitors
  ADD CONSTRAINT "monitors_active_incident_id_fkey"
  FOREIGN KEY (active_incident_id) REFERENCES incidents(id)
  DEFERRABLE INITIALLY DEFERRED;
`;
