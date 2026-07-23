export const globalHistoryIndexesMigrationSql = `
CREATE INDEX check_requests_global_history_idx
  ON check_requests (scheduled_at DESC, id DESC);
CREATE INDEX incidents_global_history_idx
  ON incidents (started_at DESC, id DESC)
`;
