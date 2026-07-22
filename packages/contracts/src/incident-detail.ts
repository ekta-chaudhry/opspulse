import { IncidentEventSchema, type IncidentEvent } from "./incident-events.js";
import { IncidentSchema, type Incident } from "./incidents.js";
import {
  NotificationDeliverySchema,
  type NotificationDelivery,
} from "./notification-deliveries.js";
import { z } from "./zod.js";

export const IncidentDetailResponseSchema = z.strictObject({
  incident: IncidentSchema,
  timeline: z.array(IncidentEventSchema),
  deliveries: z.array(NotificationDeliverySchema),
}) satisfies z.ZodType<{
  incident: Incident;
  timeline: IncidentEvent[];
  deliveries: NotificationDelivery[];
}>;
export type IncidentDetailResponse = z.infer<typeof IncidentDetailResponseSchema>;
