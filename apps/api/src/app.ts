import {
  API_ERROR_STATUS,
  ApiErrorSchema,
  CheckListQuerySchema,
  CheckListResponseSchema,
  CorrelationIdSchema,
  CreateMonitorResponseSchema,
  CreateMonitorSchema,
  IncidentListQuerySchema,
  IncidentListResponseSchema,
  LivenessResponseSchema,
  MonitorIdParamsSchema,
  z,
  type ApiErrorCode,
  type ApiErrorDetail,
  type CheckListResponse,
  type CheckListQuery,
  type HttpMonitorInput,
  type IncidentListResponse,
  type IncidentListQuery,
  type PrivateHttpMonitor,
} from "@opspulse/contracts";
import { InvalidHistoryCursorError } from "@opspulse/database";
import express, {
  type ErrorRequestHandler,
  type Request,
  type Response,
} from "express";
import { randomUUID } from "node:crypto";

export type AppDependencies = {
  createHttpMonitor: (input: HttpMonitorInput) => Promise<PrivateHttpMonitor>;
  listMonitorChecks: (
    monitorId: string,
    options: CheckListQuery,
  ) => Promise<CheckListResponse>;
  listIncidents: (options: IncidentListQuery) => Promise<IncidentListResponse>;
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

  // These private operations are unauthenticated only for this local runnable milestone.
  app.post("/v1/monitors", async (request, response) => {
    const input = parse(CreateMonitorSchema, request.body);
    if (input.kind === "heartbeat") {
      throw new ApiHttpError(
        "conflict",
        "Heartbeat monitors are not implemented in this local milestone",
      );
    }
    const monitor = await dependencies.createHttpMonitor(input);
    response.status(201).json(CreateMonitorResponseSchema.parse({ monitor }));
  });

  app.get("/v1/monitors/:monitorId/checks", async (request, response) => {
    const { monitorId } = parse(MonitorIdParamsSchema, request.params);
    const query = parse(CheckListQuerySchema, request.query);
    const result = await dependencies.listMonitorChecks(monitorId, query);
    response.json(CheckListResponseSchema.parse(result));
  });

  app.get("/v1/incidents", async (request, response) => {
    const query = parse(IncidentListQuerySchema, request.query);
    const result = await dependencies.listIncidents(query);
    response.json(IncidentListResponseSchema.parse(result));
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
