import {
  claimDueHttpCheck,
  completeHttpCheck,
  createDatabasePool,
  type DatabasePoolConfig,
  type HttpCheckOutcome,
  type HttpCheckWorkItem,
  type TransactionPool,
} from "@opspulse/database";
import { pathToFileURL } from "node:url";
import {
  checkHttpMonitor,
  type CheckerDependencies,
} from "./checker.js";
import { parseWorkerConfig, type WorkerConfig } from "./config.js";
import {
  executeSafeHttp,
  type SafeHttpRequest,
  type SafeHttpResult,
} from "./safe-client.js";

type ShutdownReason = "SIGINT" | "SIGTERM" | "internal";
type LogValue = string | number | boolean | null;
type LogEntry = { event: string } & Record<string, LogValue>;

type WorkerPool = TransactionPool & {
  end(): Promise<void>;
};

export type PollingLoopOptions = {
  pollIntervalMs: number;
  signal: AbortSignal;
  claim(): Promise<HttpCheckWorkItem | null>;
  check(workItem: HttpCheckWorkItem): Promise<unknown>;
  sleep(milliseconds: number): Promise<void>;
  log(entry: LogEntry): void;
};

export type WorkerRuntimeDependencies = {
  createPool(config: DatabasePoolConfig): WorkerPool;
  claimDueHttpCheck(pool: TransactionPool): Promise<HttpCheckWorkItem | null>;
  completeHttpCheck(
    pool: TransactionPool,
    requestId: string,
    outcome: HttpCheckOutcome,
  ): Promise<unknown>;
  checkHttpMonitor(
    workItem: HttpCheckWorkItem,
    dependencies: CheckerDependencies,
  ): Promise<unknown>;
  execute(input: SafeHttpRequest): Promise<SafeHttpResult>;
  runLoop(options: PollingLoopOptions): Promise<void>;
  sleep(milliseconds: number, signal: AbortSignal): Promise<void>;
  log(entry: LogEntry): void;
};

export type WorkerRuntime = {
  done: Promise<void>;
  close(reason: ShutdownReason): Promise<void>;
};

function writeLog(entry: LogEntry): void {
  console.log(JSON.stringify(entry));
}

function abortableSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(finish, milliseconds);
    function finish(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
    signal.addEventListener("abort", finish, { once: true });
  });
}

const defaultDependencies: WorkerRuntimeDependencies = {
  createPool: createDatabasePool,
  claimDueHttpCheck,
  completeHttpCheck,
  checkHttpMonitor,
  execute: executeSafeHttp,
  runLoop: runPollingLoop,
  sleep: abortableSleep,
  log: writeLog,
};

function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

export async function runPollingLoop(options: PollingLoopOptions): Promise<void> {
  while (!isAborted(options.signal)) {
    try {
      const workItem = await options.claim();
      if (isAborted(options.signal)) break;
      if (workItem === null) {
        await options.sleep(options.pollIntervalMs);
        continue;
      }
      await options.check(workItem);
      options.log({
        event: "http_check_completed",
        requestId: workItem.request.id,
        monitorId: workItem.request.monitorId,
      });
    } catch {
      if (isAborted(options.signal)) break;
      options.log({ event: "worker_iteration_failed", category: "internal" });
      await options.sleep(Math.min(options.pollIntervalMs, 1000));
    }
  }
}

export function startWorker(
  config: WorkerConfig,
  dependencies: WorkerRuntimeDependencies = defaultDependencies,
): WorkerRuntime {
  const pool = dependencies.createPool({ connectionString: config.databaseUrl });
  const controller = new AbortController();
  const checkerDependencies: CheckerDependencies = {
    execute: (input) => dependencies.execute(input),
    complete: (requestId, outcome) =>
      dependencies.completeHttpCheck(pool, requestId, outcome),
  };
  const done = dependencies.runLoop({
    pollIntervalMs: config.pollIntervalMs,
    signal: controller.signal,
    claim: () => dependencies.claimDueHttpCheck(pool),
    check: (workItem) => dependencies.checkHttpMonitor(workItem, checkerDependencies),
    sleep: (milliseconds) => dependencies.sleep(milliseconds, controller.signal),
    log: (entry) => {
      dependencies.log(entry);
    },
  });
  dependencies.log({ event: "worker_started" });

  let closing: Promise<void> | undefined;
  return {
    done,
    close(reason) {
      controller.abort();
      closing ??= (async () => {
        try {
          await done;
        } finally {
          await pool.end();
        }
        dependencies.log({ event: "worker_stopped", signal: reason });
      })();
      return closing;
    },
  };
}

export function runWorker(
  env: NodeJS.ProcessEnv = process.env,
  dependencies: WorkerRuntimeDependencies = defaultDependencies,
): WorkerRuntime {
  const runtime = startWorker(parseWorkerConfig(env), dependencies);
  const shutdown = (signal: "SIGINT" | "SIGTERM"): void => {
    void runtime.close(signal).catch(() => {
      dependencies.log({ event: "worker_shutdown_failed", category: "internal" });
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  void runtime.done.catch(() => {
    dependencies.log({ event: "worker_loop_failed", category: "internal" });
    process.exitCode = 1;
    void runtime.close("internal").catch(() => undefined);
  });
  return runtime;
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  try {
    runWorker();
  } catch {
    writeLog({ event: "worker_start_failed", category: "internal" });
    process.exitCode = 1;
  }
}
