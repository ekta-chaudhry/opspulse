import {
  API_ERROR_STATUS,
  ApiErrorSchema,
  CheckListQuerySchema,
  ChannelIdParamsSchema,
  ChannelListQuerySchema,
  ChannelListResponseSchema,
  ChannelResponseSchema,
  CheckListResponseSchema,
  CorrelationIdSchema,
  CreateMonitorResponseSchema,
  CreateMonitorSchema,
  HeartbeatAcceptedSchema,
  HeartbeatHeadersSchema,
  HeartbeatTokenParamsSchema,
  HeartbeatTokenResponseSchema,
  CreateNotificationChannelSchema,
  DeliveryIdParamsSchema,
  DeliveryListQuerySchema,
  DeliveryListResponseSchema,
  IncidentDetailResponseSchema,
  IncidentIdParamsSchema,
  IncidentListQuerySchema,
  IncidentListResponseSchema,
  LifecycleCommandResponseSchema,
  LivenessResponseSchema,
  MonitorIdParamsSchema,
  MonitorListQuerySchema,
  MonitorListResponseSchema,
  MonitorResponseSchema,
  ReplayDeliverySchema,
  UpdateMonitorSchema,
  UpdateNotificationChannelSchema,
  z,
  type ApiErrorCode,
  type ApiErrorDetail,
  type ChannelListQuery,
  type ChannelListResponse,
  type ChannelResponse,
  type CheckListResponse,
  type CheckListQuery,
  type DeliveryListQuery,
  type DeliveryListResponse,
  type CreateNotificationChannel,
  type CreateMonitorResponse,
  type HeartbeatMonitorInput,
  type HttpMonitorInput,
  type IncidentDetailResponse,
  type IncidentListResponse,
  type IncidentListQuery,
  type MonitorListQuery,
  type MonitorListResponse,
  type PrivateHttpMonitor,
  type PrivateMonitor,
  type ReplayDelivery,
  type UpdateMonitor,
  type UpdateNotificationChannel,
} from "@opspulse/contracts";
import {
  HeartbeatTokenNotFoundError,
  IncidentNotFoundError,
  InvalidHistoryCursorError,
  MonitorLifecycleConflictError,
  MonitorNotFoundError,
  NotificationChannelNotFoundError,
  NotificationDeliveryNotFoundError,
  NotificationDeliveryReplayConflictError,
} from "@opspulse/database";
import express, {
  type ErrorRequestHandler,
  type Request,
  type Response,
} from "express";
import { randomUUID } from "node:crypto";
import { DASHBOARD_HTML } from "./dashboard.js";

export type AppDependencies = {
  archiveMonitor: (monitorId: string) => Promise<PrivateMonitor>;
  archiveNotificationChannel: (channelId: string) => Promise<unknown>;
  attachNotificationChannelToMonitor: (
    monitorId: string,
    channelId: string,
  ) => Promise<ChannelResponse>;
  createHeartbeatMonitor: (input: HeartbeatMonitorInput) => Promise<CreateMonitorResponse>;
  createHttpMonitor: (input: HttpMonitorInput) => Promise<PrivateHttpMonitor>;
  createNotificationChannel: (
    input: CreateNotificationChannel,
  ) => Promise<unknown>;
  detachNotificationChannelFromMonitor: (
    monitorId: string,
    channelId: string,
  ) => Promise<ChannelResponse>;
  getIncidentDetail: (incidentId: string) => Promise<IncidentDetailResponse>;
  getMonitor: (monitorId: string) => Promise<PrivateMonitor | null>;
  listChecks: (options: CheckListQuery) => Promise<CheckListResponse>;
  listMonitors: (options: MonitorListQuery) => Promise<MonitorListResponse>;
  listMonitorChecks: (
    monitorId: string,
    options: CheckListQuery,
  ) => Promise<CheckListResponse>;
  listIncidents: (options: IncidentListQuery) => Promise<IncidentListResponse>;
  listNotificationChannels: (options: ChannelListQuery) => Promise<ChannelListResponse>;
  listNotificationDeliveries: (options: DeliveryListQuery) => Promise<DeliveryListResponse>;
  pauseMonitor: (monitorId: string) => Promise<PrivateMonitor>;
  replayNotificationDelivery: (
    deliveryId: string,
    input: ReplayDelivery,
  ) => Promise<unknown>;
  resumeMonitor: (monitorId: string) => Promise<PrivateMonitor>;
  recordHeartbeatPing: (token: string, headers: import("@opspulse/contracts").HeartbeatHeaders) => Promise<unknown>;
  rotateHeartbeatToken: (monitorId: string) => Promise<unknown>;
  updateMonitor: (monitorId: string, input: UpdateMonitor) => Promise<PrivateMonitor>;
  updateNotificationChannel: (
    channelId: string,
    input: UpdateNotificationChannel,
  ) => Promise<unknown>;
};

class ApiHttpError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details: ApiErrorDetail[] = [],
  ) {
    super(message);
  }
}

function correlationId(request: Request): string {
  const incoming = CorrelationIdSchema.safeParse(request.get("x-correlation-id"));
  return incoming.success ? incoming.data : randomUUID();
}

function getCorrelationId(response: Response): string {
  const value: unknown = response.locals.correlationId;
  return CorrelationIdSchema.parse(value);
}

function validationDetails(error: z.ZodError): ApiErrorDetail[] {
  return error.issues.map((issue) => ({
    field: issue.path.length === 0 ? null : issue.path.join("."),
    issue: issue.message,
  }));
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ApiHttpError(
      "invalid_request",
      "Request validation failed",
      validationDetails(result.error),
    );
  }
  return result.data;
}

function isBodyParserError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { status?: unknown; type?: unknown };
  return (
    candidate.status === 400 ||
    candidate.status === 413 ||
    candidate.type === "entity.parse.failed" ||
    candidate.type === "entity.too.large"
  );
}

export function createApp(dependencies: AppDependencies): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use((request, response, next) => {
    const id = correlationId(request);
    response.locals.correlationId = id;
    response.setHeader("X-Correlation-ID", id);
    next();
  });
  app.use(express.json({ limit: "64kb", strict: true }));

  app.get("/health/live", (_request, response) => {
    response.json(
      LivenessResponseSchema.parse({
        service: "api",
        status: "alive",
        checkedAt: new Date().toISOString(),
      }),
    );
  });

  app.get("/", (_request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.type("html").send(DASHBOARD_HTML);
  });

  // These private operations are unauthenticated only for this local runnable milestone.
  app.get("/v1/monitors", async (request, response) => {
    const query = parse(MonitorListQuerySchema, request.query);
    const result = await dependencies.listMonitors(query);
    response.json(MonitorListResponseSchema.parse(result));
  });

  app.get("/v1/checks", async (request, response) => {
    const query = parse(CheckListQuerySchema, request.query);
    const result = await dependencies.listChecks(query);
    response.json(CheckListResponseSchema.parse(result));
  });

  app.post("/v1/heartbeats/:token", async (request, response) => {
    const { token } = parse(HeartbeatTokenParamsSchema, request.params);
    const headers = parse(HeartbeatHeadersSchema, {
      "idempotency-key": request.get("idempotency-key"),
    });
    const result = await dependencies.recordHeartbeatPing(token, headers);
    response.status(202).json(HeartbeatAcceptedSchema.parse(result));
  });

  app.get("/v1/deliveries", async (request, response) => {
    const query = parse(DeliveryListQuerySchema, request.query);
    const result = await dependencies.listNotificationDeliveries(query);
    response.json(DeliveryListResponseSchema.parse(result));
  });

  app.post("/v1/deliveries/:deliveryId/replay", async (request, response) => {
    const { deliveryId } = parse(DeliveryIdParamsSchema, request.params);
    const input = parse(ReplayDeliverySchema, request.body);
    const delivery = await dependencies.replayNotificationDelivery(deliveryId, input);
    response.status(201).json({ delivery });
  });

  app.get("/v1/channels", async (request, response) => {
    const query = parse(ChannelListQuerySchema, request.query);
    const result = await dependencies.listNotificationChannels(query);
    response.json(ChannelListResponseSchema.parse(result));
  });

  app.post("/v1/channels", async (request, response) => {
    const input = parse(CreateNotificationChannelSchema, request.body);
    const channel = await dependencies.createNotificationChannel(input);
    response.status(201).json(ChannelResponseSchema.parse({ channel }));
  });

  app.patch("/v1/channels/:channelId", async (request, response) => {
    const { channelId } = parse(ChannelIdParamsSchema, request.params);
    const input = parse(UpdateNotificationChannelSchema, request.body);
    const channel = await dependencies.updateNotificationChannel(channelId, input);
    response.json(ChannelResponseSchema.parse({ channel }));
  });

  app.post("/v1/channels/:channelId/archive", async (request, response) => {
    const { channelId } = parse(ChannelIdParamsSchema, request.params);
    const channel = await dependencies.archiveNotificationChannel(channelId);
    response.json(ChannelResponseSchema.parse({ channel }));
  });

  app.post("/v1/monitors/:monitorId/channels/:channelId", async (request, response) => {
    const { monitorId } = parse(MonitorIdParamsSchema, {
      monitorId: request.params.monitorId,
    });
    const { channelId } = parse(ChannelIdParamsSchema, {
      channelId: request.params.channelId,
    });
    const result = await dependencies.attachNotificationChannelToMonitor(monitorId, channelId);
    response.json(ChannelResponseSchema.parse(result));
  });

  app.delete("/v1/monitors/:monitorId/channels/:channelId", async (request, response) => {
    const { monitorId } = parse(MonitorIdParamsSchema, {
      monitorId: request.params.monitorId,
    });
    const { channelId } = parse(ChannelIdParamsSchema, {
      channelId: request.params.channelId,
    });
    const result = await dependencies.detachNotificationChannelFromMonitor(monitorId, channelId);
    response.json(ChannelResponseSchema.parse(result));
  });

  app.post("/v1/monitors", async (request, response) => {
    const input = parse(CreateMonitorSchema, request.body);
    if (input.kind === "heartbeat") {
      const result = await dependencies.createHeartbeatMonitor(input);
      response.status(201).json(CreateMonitorResponseSchema.parse(result));
      return;
    }
    const monitor = await dependencies.createHttpMonitor(input);
    response.status(201).json(CreateMonitorResponseSchema.parse({ monitor }));
  });

  app.post("/v1/monitors/:monitorId/heartbeat-token", async (request, response) => {
    const { monitorId } = parse(MonitorIdParamsSchema, request.params);
    const token = await dependencies.rotateHeartbeatToken(monitorId);
    response.json(HeartbeatTokenResponseSchema.parse(token));
  });

  app.get("/v1/monitors/:monitorId", async (request, response) => {
    const { monitorId } = parse(MonitorIdParamsSchema, request.params);
    const monitor = await dependencies.getMonitor(monitorId);
    if (monitor === null) throw new ApiHttpError("not_found", "Monitor not found");
    response.json(MonitorResponseSchema.parse({ monitor }));
  });

  app.patch("/v1/monitors/:monitorId", async (request, response) => {
    const { monitorId } = parse(MonitorIdParamsSchema, request.params);
    const input = parse(UpdateMonitorSchema, request.body);
    const monitor = await dependencies.updateMonitor(monitorId, input);
    response.json(MonitorResponseSchema.parse({ monitor }));
  });

  for (const command of ["pause", "resume", "archive"] as const) {
    app.post(`/v1/monitors/:monitorId/${command}`, async (request, response) => {
      const { monitorId } = parse(MonitorIdParamsSchema, request.params);
      const monitor = await dependencies[`${command}Monitor`](monitorId);
      response.json(LifecycleCommandResponseSchema.parse({ monitor }));
    });
  }

  app.get("/v1/monitors/:monitorId/checks", async (request, response) => {
    const { monitorId } = parse(MonitorIdParamsSchema, request.params);
    const query = parse(CheckListQuerySchema, request.query);
    const monitor = await dependencies.getMonitor(monitorId);
    if (monitor === null) throw new ApiHttpError("not_found", "Monitor not found");
    const result = await dependencies.listMonitorChecks(monitorId, query);
    response.json(CheckListResponseSchema.parse(result));
  });

  app.get("/v1/incidents", async (request, response) => {
    const query = parse(IncidentListQuerySchema, request.query);
    const result = await dependencies.listIncidents(query);
    response.json(IncidentListResponseSchema.parse(result));
  });

  app.get("/v1/incidents/:incidentId", async (request, response) => {
    const { incidentId } = parse(IncidentIdParamsSchema, request.params);
    const result = await dependencies.getIncidentDetail(incidentId);
    response.json(IncidentDetailResponseSchema.parse(result));
  });

  app.use((_request, _response, next) => {
    next(new ApiHttpError("not_found", "Route not found"));
  });

  const errorHandler: ErrorRequestHandler = (error, _request, response, next) => {
    void next;
    const known = error instanceof ApiHttpError
      ? error
      : error instanceof InvalidHistoryCursorError
        ? new ApiHttpError("invalid_request", "Request validation failed", [
          { field: "cursor", issue: "Invalid cursor" },
        ])
        : error instanceof MonitorNotFoundError
          ? new ApiHttpError("not_found", "Monitor not found")
          : error instanceof HeartbeatTokenNotFoundError
            ? new ApiHttpError("not_found", "Heartbeat token not found")
          : error instanceof NotificationChannelNotFoundError
            ? new ApiHttpError("not_found", "Notification channel not found")
          : error instanceof NotificationDeliveryNotFoundError
            ? new ApiHttpError("not_found", "Notification delivery not found")
          : error instanceof IncidentNotFoundError
            ? new ApiHttpError("not_found", "Incident not found")
          : error instanceof NotificationDeliveryReplayConflictError
            ? new ApiHttpError("conflict", error.message)
          : error instanceof MonitorLifecycleConflictError
            ? new ApiHttpError("conflict", error.message)
        : isBodyParserError(error)
        ? new ApiHttpError("invalid_request", "Request body is invalid")
        : new ApiHttpError("internal_error", "An internal error occurred");
    const body = ApiErrorSchema.parse({
      error: {
        code: known.code,
        message: known.message,
        correlationId: getCorrelationId(response),
        details: known.details,
      },
    });
    response.status(API_ERROR_STATUS[known.code]).json(body);
  };
  app.use(errorHandler);
  return app;
}
