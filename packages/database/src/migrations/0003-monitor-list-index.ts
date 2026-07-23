export const monitorListIndexMigrationSql = `
CREATE INDEX monitors_history_idx ON monitors (created_at DESC, id DESC)
`;
