import type { HttpMonitorInput } from "@opspulse/contracts";
import type { Express } from "express";
import { describe, expect, it, vi } from "vitest";
import type { AppDependencies } from "./app.js";
import {
  startApiServer,
  type ApiRuntimeDependencies,
  type ClosableServer,
} from "./server.js";

describe("startApiServer", () => {
  it("wires database operations and closes the server and pool once", async () => {
    const pool = {
      query: vi.fn(() => Promise.resolve({ rows: [] })),
      end: vi.fn(() => Promise.resolve()),
    };
    const server = {
      close: vi.fn((callback: (error?: Error) => void) => {
        callback();
      }),
    } satisfies ClosableServer;
    const app = {} as Express;
    let appDependencies: AppDependencies | undefined;
    const createHttpMonitor = vi.fn(() => Promise.resolve({ marker: "monitor" }));
    const getMonitor = vi.fn(() => Promise.resolve({ marker: "monitor-detail" }));
    const pauseMonitor = vi.fn(() => Promise.resolve({ marker: "paused" }));
    const resumeMonitor = vi.fn(() => Promise.resolve({ marker: "resumed" }));
    const archiveMonitor = vi.fn(() => Promise.resolve({ marker: "archived" }));
    const updateMonitor = vi.fn(() => Promise.resolve({ marker: "updated" }));
    const listMonitors = vi.fn(() => Promise.resolve({ marker: "monitors" }));
    const listChecks = vi.fn(() => Promise.resolve({ marker: "recent-checks" }));
    const listMonitorChecks = vi.fn(() => Promise.resolve({ marker: "checks" }));
    const listIncidents = vi.fn(() => Promise.resolve({ marker: "incidents" }));
    const createPool = vi.fn(() => pool);
    const listen = vi.fn(() => Promise.resolve(server));
    const log = vi.fn();
    const dependencies = {
      createPool,
      createApplication: vi.fn((value: AppDependencies) => {
        appDependencies = value;
        return app;
      }),
      createHttpMonitor,
      getMonitor,
      pauseMonitor,
      resumeMonitor,
      archiveMonitor,
      updateMonitor,
      listMonitors,
      listChecks,
      listMonitorChecks,
      listIncidents,
      listen,
      log,
    } as unknown as ApiRuntimeDependencies;

    const runtime = await startApiServer(
      {
        databaseUrl: "postgresql://localhost/opspulse",
        host: "0.0.0.0",
        port: 3000,
      },
      dependencies,
    );

    expect(createPool).toHaveBeenCalledWith({
      connectionString: "postgresql://localhost/opspulse",
    });
    expect(listen).toHaveBeenCalledWith(app, 3000, "0.0.0.0");
    expect(log).toHaveBeenCalledWith({ event: "api_started", host: "0.0.0.0", port: 3000 });

    const operations = appDependencies;
    if (operations === undefined) throw new Error("application dependencies were not captured");
    const input = { kind: "http" } as HttpMonitorInput;
    await operations.createHttpMonitor(input);
    await operations.getMonitor("monitor-id");
    await operations.pauseMonitor("monitor-id");
    await operations.resumeMonitor("monitor-id");
    await operations.archiveMonitor("monitor-id");
    await operations.updateMonitor("monitor-id", { kind: "http", name: "Primary API" });
    await operations.listMonitors({ limit: 25 });
    await operations.listChecks({ limit: 12 });
    await operations.listMonitorChecks("monitor-id", { limit: 10 });
    await operations.listIncidents({ status: "open", limit: 5 });
    expect(createHttpMonitor).toHaveBeenCalledWith(pool, input);
    expect(getMonitor).toHaveBeenCalledWith(pool, "monitor-id");
    expect(pauseMonitor).toHaveBeenCalledWith(pool, "monitor-id");
    expect(resumeMonitor).toHaveBeenCalledWith(pool, "monitor-id");
    expect(archiveMonitor).toHaveBeenCalledWith(pool, "monitor-id");
    expect(updateMonitor).toHaveBeenCalledWith(pool, "monitor-id", {
      kind: "http",
      name: "Primary API",
    });
    expect(listMonitors).toHaveBeenCalledWith(pool, { limit: 25 });
    expect(listChecks).toHaveBeenCalledWith(pool, { limit: 12 });
    expect(listMonitorChecks).toHaveBeenCalledWith(pool, "monitor-id", {
      limit: 10,
    });
    expect(listIncidents).toHaveBeenCalledWith(pool, {
      status: "open",
      limit: 5,
    });

    await runtime.close("SIGTERM");
    await runtime.close("SIGTERM");
    expect(server.close).toHaveBeenCalledOnce();
    expect(pool.end).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith({ event: "api_stopped", signal: "SIGTERM" });
  });
});
