import {
  archiveMonitor,
  archiveNotificationChannel,
  attachNotificationChannelToMonitor,
  createDatabasePool,
  createHttpMonitor,
  createNotificationChannel,
  detachNotificationChannelFromMonitor,
  getIncidentDetail,
  getMonitor,
  listChecks,
  listIncidents,
  listMonitorChecks,
  listMonitors,
  listNotificationChannels,
  listNotificationDeliveries,
  pauseMonitor,
  replayNotificationDelivery,
  resumeMonitor,
  updateMonitor,
  updateNotificationChannel,
  type DatabasePoolConfig,
  type QueryClient,
  type TransactionPool,
} from "@opspulse/database";
import type { Express } from "express";
import { pathToFileURL } from "node:url";
import { createApp, type AppDependencies } from "./app.js";
import { parseApiConfig, type ApiConfig } from "./config.js";

type ShutdownSignal = "SIGINT" | "SIGTERM";
type LogValue = string | number | boolean | null;
type LogEntry = { event: string } & Record<string, LogValue>;

export type ClosableServer = {
  close(callback: (error?: Error) => void): void;
};

type ApiPool = QueryClient & TransactionPool & {
  end(): Promise<void>;
};

export type ApiRuntimeDependencies = {
  archiveMonitor: typeof archiveMonitor;
  archiveNotificationChannel: typeof archiveNotificationChannel;
  attachNotificationChannelToMonitor: typeof attachNotificationChannelToMonitor;
  createPool(config: DatabasePoolConfig): ApiPool;
  createApplication(dependencies: AppDependencies): Express;
  createHttpMonitor: typeof createHttpMonitor;
  createNotificationChannel: typeof createNotificationChannel;
  detachNotificationChannelFromMonitor: typeof detachNotificationChannelFromMonitor;
  getIncidentDetail: typeof getIncidentDetail;
  getMonitor: typeof getMonitor;
  listChecks: typeof listChecks;
  listIncidents: typeof listIncidents;
  listMonitorChecks: typeof listMonitorChecks;
  listMonitors: typeof listMonitors;
  listNotificationChannels: typeof listNotificationChannels;
  listNotificationDeliveries: typeof listNotificationDeliveries;
  pauseMonitor: typeof pauseMonitor;
  replayNotificationDelivery: typeof replayNotificationDelivery;
  resumeMonitor: typeof resumeMonitor;
  updateMonitor: typeof updateMonitor;
  updateNotificationChannel: typeof updateNotificationChannel;
  listen(app: Express, port: number, host: string): Promise<ClosableServer>;
  log(entry: LogEntry): void;
};

export type ApiRuntime = {
  close(signal: ShutdownSignal): Promise<void>;
};

function writeLog(entry: LogEntry): void {
  console.log(JSON.stringify(entry));
}

function listen(app: Express, port: number, host: string): Promise<ClosableServer> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host);
    const onError = (error: Error): void => {
      server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.removeListener("error", onError);
      resolve(server);
    };
    server.once("error", onError);
    server.once("listening", onListening);
  });
}

const defaultDependencies: ApiRuntimeDependencies = {
  archiveMonitor,
  archiveNotificationChannel,
  attachNotificationChannelToMonitor,
  createPool: createDatabasePool,
  createApplication: createApp,
  createHttpMonitor,
  createNotificationChannel,
  detachNotificationChannelFromMonitor,
  getIncidentDetail,
  getMonitor,
  listChecks,
  listIncidents,
  listMonitorChecks,
  listMonitors,
  listNotificationChannels,
  listNotificationDeliveries,
  pauseMonitor,
  replayNotificationDelivery,
  resumeMonitor,
  updateMonitor,
  updateNotificationChannel,
  listen,
  log: writeLog,
};

function closeServer(server: ClosableServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
}

export async function startApiServer(
  config: ApiConfig,
  dependencies: ApiRuntimeDependencies = defaultDependencies,
): Promise<ApiRuntime> {
  const pool = dependencies.createPool({ connectionString: config.databaseUrl });
  const app = dependencies.createApplication({
    archiveMonitor: (monitorId) => dependencies.archiveMonitor(pool, monitorId),
    archiveNotificationChannel: (channelId) =>
      dependencies.archiveNotificationChannel(pool, channelId),
    attachNotificationChannelToMonitor: (monitorId, channelId) =>
      dependencies.attachNotificationChannelToMonitor(pool, monitorId, channelId),
    createHttpMonitor: (input) => dependencies.createHttpMonitor(pool, input),
    createNotificationChannel: (input) => dependencies.createNotificationChannel(pool, input),
    detachNotificationChannelFromMonitor: (monitorId, channelId) =>
      dependencies.detachNotificationChannelFromMonitor(pool, monitorId, channelId),
    getIncidentDetail: (incidentId) => dependencies.getIncidentDetail(pool, incidentId),
    getMonitor: (monitorId) => dependencies.getMonitor(pool, monitorId),
    listChecks: (options) => dependencies.listChecks(pool, options),
    listMonitors: (options) => dependencies.listMonitors(pool, options),
    listMonitorChecks: (monitorId, options) =>
      dependencies.listMonitorChecks(pool, monitorId, options),
    listIncidents: (options) => dependencies.listIncidents(pool, options),
    listNotificationChannels: (options) =>
      dependencies.listNotificationChannels(pool, options),
    listNotificationDeliveries: (options) =>
      dependencies.listNotificationDeliveries(pool, options),
    pauseMonitor: (monitorId) => dependencies.pauseMonitor(pool, monitorId),
    replayNotificationDelivery: (deliveryId, input) =>
      dependencies.replayNotificationDelivery(pool, deliveryId, input),
    resumeMonitor: (monitorId) => dependencies.resumeMonitor(pool, monitorId),
    updateMonitor: (monitorId, input) => dependencies.updateMonitor(pool, monitorId, input),
    updateNotificationChannel: (channelId, input) =>
      dependencies.updateNotificationChannel(pool, channelId, input),
  });

  let server: ClosableServer;
  try {
    server = await dependencies.listen(app, config.port, config.host);
  } catch (error) {
    await pool.end();
    throw error;
  }
  dependencies.log({
    event: "api_started",
    host: config.host,
    port: config.port,
  });

  let closing: Promise<void> | undefined;
  return {
    close(signal) {
      closing ??= (async () => {
        try {
          await closeServer(server);
        } finally {
          await pool.end();
        }
        dependencies.log({ event: "api_stopped", signal });
      })();
      return closing;
    },
  };
}

export async function runApiServer(
  env: NodeJS.ProcessEnv = process.env,
  dependencies: ApiRuntimeDependencies = defaultDependencies,
): Promise<ApiRuntime> {
  const runtime = await startApiServer(parseApiConfig(env), dependencies);
  const shutdown = (signal: ShutdownSignal): void => {
    void runtime.close(signal).catch(() => {
      dependencies.log({ event: "api_shutdown_failed", category: "internal" });
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  return runtime;
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  void runApiServer().catch(() => {
    writeLog({ event: "api_start_failed", category: "internal" });
    process.exitCode = 1;
  });
}
