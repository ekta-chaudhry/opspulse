import { describe, expect, it } from "vitest";
import {
  DependencyHealthSchema,
  DependencyNameSchema,
  HealthServiceSchema,
  LivenessResponseSchema,
  NotReadyResponseSchema,
  ReadinessResponseSchema,
  ReadyResponseSchema,
} from "./health.js";

const checkedAt = "2026-07-22T12:34:56Z";
const healthyDependencies = [
  { name: "postgres", ok: true, safeMessage: null },
  { name: "redis", ok: true, safeMessage: null },
] as const;
const unhealthyDependencies = [
  { name: "postgres", ok: true, safeMessage: null },
  { name: "redis", ok: false, safeMessage: "Redis is unavailable" },
] as const;

describe("health contracts", () => {
  it("accepts exactly the API and worker services", () => {
    expect(HealthServiceSchema.safeParse("api").success).toBe(true);
    expect(HealthServiceSchema.safeParse("worker").success).toBe(true);
    expect(HealthServiceSchema.safeParse("scheduler").success).toBe(false);
  });

  it("accepts exactly the postgres and redis dependency names", () => {
    expect(DependencyNameSchema.safeParse("postgres").success).toBe(true);
    expect(DependencyNameSchema.safeParse("redis").success).toBe(true);
    expect(DependencyNameSchema.safeParse("kafka").success).toBe(false);
  });

  it("validates exact dependency health and normalizes safe messages", () => {
    expect(
      DependencyHealthSchema.parse({ name: "postgres", ok: false, safeMessage: "  unavailable  " }),
    ).toEqual({ name: "postgres", ok: false, safeMessage: "unavailable" });
    expect(
      DependencyHealthSchema.parse({ name: "redis", ok: true, safeMessage: null }),
    ).toEqual({ name: "redis", ok: true, safeMessage: null });
  });

  it("accepts liveness responses for both services", () => {
    for (const service of ["api", "worker"] as const) {
      expect(LivenessResponseSchema.parse({ service, status: "alive", checkedAt })).toEqual({
        service,
        status: "alive",
        checkedAt,
      });
    }
  });

  it("accepts a ready response when both dependencies are healthy", () => {
    const value = { service: "api", status: "ready", checkedAt, dependencies: healthyDependencies };
    expect(ReadyResponseSchema.parse(value)).toEqual(value);
    expect(ReadinessResponseSchema.safeParse(value).success).toBe(true);
  });

  it("accepts a not-ready response when a dependency is unhealthy", () => {
    const value = {
      service: "worker",
      status: "not_ready",
      checkedAt,
      dependencies: unhealthyDependencies,
    };
    expect(NotReadyResponseSchema.parse(value)).toEqual(value);
    expect(ReadinessResponseSchema.safeParse(value).success).toBe(true);
  });

  it("rejects a ready response with an unhealthy dependency", () => {
    expect(
      ReadyResponseSchema.safeParse({
        service: "api",
        status: "ready",
        checkedAt,
        dependencies: unhealthyDependencies,
      }).success,
    ).toBe(false);
  });

  it("rejects a not-ready response when every dependency is healthy", () => {
    expect(
      NotReadyResponseSchema.safeParse({
        service: "api",
        status: "not_ready",
        checkedAt,
        dependencies: healthyDependencies,
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate readiness dependencies", () => {
    expect(
      ReadinessResponseSchema.safeParse({
        service: "api",
        status: "ready",
        checkedAt,
        dependencies: [healthyDependencies[0], healthyDependencies[0]],
      }).success,
    ).toBe(false);
  });

  it("rejects missing readiness dependencies", () => {
    expect(
      ReadinessResponseSchema.safeParse({
        service: "api",
        status: "ready",
        checkedAt,
        dependencies: [healthyDependencies[0]],
      }).success,
    ).toBe(false);
  });

  it("rejects unknown top-level health keys", () => {
    expect(
      LivenessResponseSchema.safeParse({
        service: "api",
        status: "alive",
        checkedAt,
        version: "1",
      }).success,
    ).toBe(false);
    expect(
      ReadinessResponseSchema.safeParse({
        service: "api",
        status: "ready",
        checkedAt,
        dependencies: healthyDependencies,
        extra: true,
      }).success,
    ).toBe(false);
  });

  it("rejects unknown nested dependency keys", () => {
    expect(
      ReadinessResponseSchema.safeParse({
        service: "api",
        status: "ready",
        checkedAt,
        dependencies: [
          { ...healthyDependencies[0], latencyMs: 1 },
          healthyDependencies[1],
        ],
      }).success,
    ).toBe(false);
  });
});
