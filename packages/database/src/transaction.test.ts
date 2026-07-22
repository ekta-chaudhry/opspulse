import { expect, it } from "vitest";
import { withTransaction, type TransactionClient } from "./transaction.js";

class FakeClient implements TransactionClient {
  readonly statements: string[] = [];
  released = false;
  failOn?: string;

  query(text: string): Promise<{ rows: unknown[] }> {
    this.statements.push(text);
    if (text === this.failOn) return Promise.reject(new Error(`${text} failed`));
    return Promise.resolve({ rows: [] });
  }

  release(): void {
    this.released = true;
  }
}

const poolFor = (client: FakeClient) => ({
  connect(): Promise<FakeClient> {
    return Promise.resolve(client);
  },
});

it("commits a successful transaction and releases its client", async () => {
  const client = new FakeClient();

  const result = await withTransaction(poolFor(client), async (transaction) => {
    await transaction.query("SELECT work");
    return "complete";
  });

  expect(result).toBe("complete");
  expect(client.statements).toEqual(["BEGIN", "SELECT work", "COMMIT"]);
  expect(client.released).toBe(true);
});

it("rolls back callback failures and preserves the original error", async () => {
  const client = new FakeClient();
  const originalFailure = new Error("work failed");

  const result = withTransaction(poolFor(client), () => {
    throw originalFailure;
  });

  await expect(result).rejects.toBe(originalFailure);
  expect(client.statements).toEqual(["BEGIN", "ROLLBACK"]);
  expect(client.released).toBe(true);
});

it("does not replace the original failure when rollback also fails", async () => {
  const client = new FakeClient();
  client.failOn = "ROLLBACK";
  const originalFailure = new Error("work failed");

  const result = withTransaction(poolFor(client), () => {
    throw originalFailure;
  });

  await expect(result).rejects.toBe(originalFailure);
  expect(client.released).toBe(true);
});

it("rolls back commit failures and releases its client", async () => {
  const client = new FakeClient();
  client.failOn = "COMMIT";

  await expect(withTransaction(poolFor(client), () => "complete")).rejects.toThrow(
    "COMMIT failed",
  );
  expect(client.statements).toEqual(["BEGIN", "COMMIT", "ROLLBACK"]);
  expect(client.released).toBe(true);
});
