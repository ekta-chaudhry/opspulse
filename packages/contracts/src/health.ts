import { SafeMessageSchema, TimestampSchema } from "./common.js";
import { z } from "./zod.js";

export const HealthServiceSchema = z.enum(["api", "worker"]);
export type HealthService = z.infer<typeof HealthServiceSchema>;

export const DependencyNameSchema = z.enum(["postgres", "redis"]);
export type DependencyName = z.infer<typeof DependencyNameSchema>;

export const DependencyHealthSchema = z.strictObject({
  name: DependencyNameSchema,
  ok: z.boolean(),
  safeMessage: SafeMessageSchema.nullable(),
});
export type DependencyHealth = z.infer<typeof DependencyHealthSchema>;

const ReadinessDependenciesSchema = z
  .array(DependencyHealthSchema)
  .length(2)
  .superRefine((dependencies, context) => {
    for (const requiredName of DependencyNameSchema.options) {
      if (dependencies.filter(({ name }) => name === requiredName).length !== 1) {
        context.addIssue({
          code: "custom",
          message: `Dependencies must contain exactly one ${requiredName}`,
        });
      }
    }
  });

export const LivenessResponseSchema = z.strictObject({
  service: HealthServiceSchema,
  status: z.literal("alive"),
  checkedAt: TimestampSchema,
});
export type LivenessResponse = z.infer<typeof LivenessResponseSchema>;

export const ReadyResponseSchema = z
  .strictObject({
    service: HealthServiceSchema,
    status: z.literal("ready"),
    checkedAt: TimestampSchema,
    dependencies: ReadinessDependenciesSchema,
  })
  .superRefine((response, context) => {
    if (response.dependencies.some(({ ok }) => !ok)) {
      context.addIssue({
        code: "custom",
        message: "Ready responses require every dependency to be healthy",
        path: ["dependencies"],
      });
    }
  });
export type ReadyResponse = z.infer<typeof ReadyResponseSchema>;

export const NotReadyResponseSchema = z
  .strictObject({
    service: HealthServiceSchema,
    status: z.literal("not_ready"),
    checkedAt: TimestampSchema,
    dependencies: ReadinessDependenciesSchema,
  })
  .superRefine((response, context) => {
    if (response.dependencies.every(({ ok }) => ok)) {
      context.addIssue({
        code: "custom",
        message: "Not-ready responses require an unhealthy dependency",
        path: ["dependencies"],
      });
    }
  });
export type NotReadyResponse = z.infer<typeof NotReadyResponseSchema>;

export const ReadinessResponseSchema = z.union([ReadyResponseSchema, NotReadyResponseSchema]);
export type ReadinessResponse = z.infer<typeof ReadinessResponseSchema>;
