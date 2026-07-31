export const notificationChannelsMigrationSql = `
CREATE TABLE notification_channels (
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  name TEXT NOT NULL,
  webhook_url TEXT NOT NULL,
  signing_secret TEXT NOT NULL,
  enabled BOOLEAN DEFAULT true NOT NULL,
  lifecycle TEXT DEFAULT 'active' NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT "notification_channels_pkey" PRIMARY KEY (id),
  CONSTRAINT "notification_channels_name_check" CHECK (
    char_length(btrim(name)) BETWEEN 1 AND 100 AND name = btrim(name)
  ),
  CONSTRAINT "notification_channels_url_check" CHECK (
    char_length(webhook_url) BETWEEN 1 AND 2048 AND
    webhook_url ~ '^https?://'
  ),
  CONSTRAINT "notification_channels_signing_secret_check" CHECK (
    char_length(signing_secret) BETWEEN 32 AND 1024
  ),
  CONSTRAINT "notification_channels_lifecycle_check" CHECK (
    lifecycle IN ('active', 'archived')
  ),
  CONSTRAINT "notification_channels_updated_at_check" CHECK (updated_at >= created_at)
);

CREATE INDEX notification_channels_list_idx
  ON notification_channels (created_at DESC, id DESC) WHERE lifecycle = 'active';
CREATE INDEX notification_channels_lifecycle_list_idx
  ON notification_channels (lifecycle, created_at DESC, id DESC);

CREATE TABLE monitor_notification_channels (
  monitor_id UUID NOT NULL,
  channel_id UUID NOT NULL,
  enabled BOOLEAN DEFAULT true NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT "monitor_notification_channels_pkey" PRIMARY KEY (monitor_id, channel_id),
  CONSTRAINT "monitor_notification_channels_monitor_id_fkey" FOREIGN KEY (monitor_id)
    REFERENCES monitors(id) ON DELETE RESTRICT,
  CONSTRAINT "monitor_notification_channels_channel_id_fkey" FOREIGN KEY (channel_id)
    REFERENCES notification_channels(id) ON DELETE RESTRICT,
  CONSTRAINT "monitor_notification_channels_updated_at_check" CHECK (updated_at >= created_at)
);

CREATE INDEX monitor_notification_channels_channel_idx
  ON monitor_notification_channels (channel_id, monitor_id);
CREATE INDEX monitor_notification_channels_enabled_monitor_idx
  ON monitor_notification_channels (monitor_id, channel_id) WHERE enabled;
`;
