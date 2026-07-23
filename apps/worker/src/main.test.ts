import type { HttpCheckWorkItem } from "@opspulse/database";
import { describe, expect, it, vi } from "vitest";
import type { CheckerDependencies } from "./checker.js";
import {
  runPollingLoop,
  startWorker,
  type WorkerRuntimeDependencies,
} from "./main.js";

const workItem = {
  request: {
    id: "11111111-1111-4111-8111-111111111111",
    monitorId: "22222222-2222-4222-8222-222222222222",
  },
} as HttpCheckWorkItem;

describe("runPollingLoop", () => {
  it("checks claimed work one at a time and sleeps when idle", async () => {
    const controller = new AbortController();
    const claim = vi
      .fn<() => Promise<HttpCheckWorkItem | null>>()
      .mockResolvedValueOnce(workItem)
      .mockResolvedValueOnce(null);
    const check = vi.fn(() => Promise.resolve());
    const sleep = vi.fn((milliseconds: number) => {
      expect(milliseconds).toBe(500);
      controller.abort();
      return Promise.resolve();
    });
    const log = vi.fn();

    await runPollingLoop({
      pollIntervalMs: 500,
      signal: controller.signal,
      claim,
      check,
      sleep,
      log,
    });

    expect(claim).toHaveBeenCalledTimes(2);
    expect(check).toHaveBeenCalledOnce();
    expect(check).toHaveBeenCalledWith(workItem);
    expect(log).toHaveBeenCalledWith({
      event: "http_check_completed",
      requestId: workItem.request.id,
      monitorId: workItem.request.monitorId,
    });
  });

  it("logs only a safe category and applies bounded backoff after an internal error", async () => {
    const controller = new AbortController();
    const claim = vi.fn(() =>
      Promise.reject(new Error("postgresql://owner:secret@private-db/opspulse")),
    );
    const sleep = vi.fn(() => {
      controller.abort();
      return Promise.resolve();
    });
    const log = vi.fn();

    await runPollingLoop({
      pollIntervalMs: 60_000,
      signal: controller.signal,
      claim,
      check: vi.fn(() => Promise.resolve()),
      sleep,
      log,
    });

    expect(sleep).toHaveBeenCalledWith(1000);
    expect(log).toHaveBeenCalledWith({
      event: "worker_iteration_failed",
      category: "internal",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-db");
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
  });
});

describe("startWorker", () => {
  it("wires claimed work and closes the polling loop and pool once", async () => {
    const pool = {
      connect: vi.fn(),
      end: vi.fn(() => Promise.resolve()),
    };
    const claimDueHttpCheck = vi.fn(() => Promise.resolve(workItem));
    const completeHttpCheck = vi.fn(() => Promise.resolve({ marker: "completed" }));
    const checkHttpMonitor = vi.fn(async (
      _item: HttpCheckWorkItem,
      dependencies: CheckerDependencies,
    ) => {
      await dependencies.complete("request-id", {
        result: "success",
        httpStatus: 204,
        latencyMs: 10,
        cause: null,
      });
    });
    let resolveLoop: (() => void) | undefined;
    const loopDone = new Promise<void>((resolve) => {
      resolveLoop = resolve;
    });
    let loopOptions: Parameters<typeof runPollingLoop>[0] | undefined;
    const runLoop = vi.fn((options: Parameters<typeof runPollingLoop>[0]) => {
      loopOptions = options;
      return loopDone;
    });
    const log = vi.fn();
    const createPool = vi.fn(() => pool);
    const dependencies = {
      createPool,
      claimDueHttpCheck,
      completeHttpCheck,
      checkHttpMonitor,
      runLoop,
      sleep: vi.fn(() => Promise.resolve()),
      log,
    } as unknown as WorkerRuntimeDependencies;

    const runtime = startWorker(
      { databaseUrl: "postgresql://localhost/opspulse", pollIntervalMs: 500 },
      dependencies,
    );
    const options = loopOptions;
    if (options === undefined) throw new Error("polling options were not captured");
    await options.claim();
    await options.check(workItem);

    expect(createPool).toHaveBeenCalledWith({
      connectionString: "postgresql://localhost/opspulse",
    });
    expect(claimDueHttpCheck).toHaveBeenCalledWith(pool);
    expect(checkHttpMonitor).toHaveBeenCalledWith(workItem, expect.any(Object));
    expect(completeHttpCheck).toHaveBeenCalledWith(pool, "request-id", {
      result: "success",
      httpStatus: 204,
      latencyMs: 10,
      cause: null,
    });
    expect(log).toHaveBeenCalledWith({ event: "worker_started" });

    const closing = runtime.close("SIGINT");
    expect(options.signal.aborted).toBe(true);
    resolveLoop?.();
    await closing;
    await runtime.close("SIGINT");
    expect(pool.end).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith({ event: "worker_stopped", signal: "SIGINT" });
  });
});
