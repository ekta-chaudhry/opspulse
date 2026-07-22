export type TransactionQueryResult = {
  rows: unknown[];
};

export interface TransactionClient {
  query(text: string, values?: unknown[]): Promise<TransactionQueryResult>;
  release(): void;
}

export interface TransactionPool {
  connect(): Promise<TransactionClient>;
}

export async function withTransaction<Result>(
  pool: TransactionPool,
  operation: (client: TransactionClient) => Promise<Result> | Result,
): Promise<Result> {
  const client = await pool.connect();
  let result: Result;

  try {
    await client.query("BEGIN");
    result = await operation(client);
    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // The transaction failure is more useful than a secondary rollback failure.
    }
    try {
      client.release();
    } catch {
      // The transaction failure is more useful than a secondary release failure.
    }
    throw error;
  }

  client.release();
  return result;
}
