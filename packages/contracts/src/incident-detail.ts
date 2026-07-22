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
}).superRefine(({ incident, timeline, deliveries }, context) => {
  const incidentId = incident.id.toLowerCase();
  const timelineEventIds = new Set<string>();
  for (const [index, event] of timeline.entries()) {
    if (event.incidentId.toLowerCase() !== incidentId) {
      context.addIssue({
        code: "custom",
        path: ["timeline", index, "incidentId"],
        message: "timeline incidentId must match envelope incident id",
      });
    }
    const eventId = event.id.toLowerCase();
    if (timelineEventIds.has(eventId)) {
      context.addIssue({
        code: "custom",
        path: ["timeline", index, "id"],
        message: "timeline event ids must be unique",
      });
    }
    timelineEventIds.add(eventId);
  }

  const deliveryIds = new Set<string>();
  for (const [index, delivery] of deliveries.entries()) {
    if (!timelineEventIds.has(delivery.incidentEventId.toLowerCase())) {
      context.addIssue({
        code: "custom",
        path: ["deliveries", index, "incidentEventId"],
        message: "delivery incidentEventId must reference a timeline event",
      });
    }
    const deliveryId = delivery.id.toLowerCase();
    if (deliveryIds.has(deliveryId)) {
      context.addIssue({
        code: "custom",
        path: ["deliveries", index, "id"],
        message: "delivery ids must be unique",
      });
    }
    deliveryIds.add(deliveryId);
  }
}) satisfies z.ZodType<{
  incident: Incident;
  timeline: IncidentEvent[];
  deliveries: NotificationDelivery[];
}>;
export type IncidentDetailResponse = z.infer<typeof IncidentDetailResponseSchema>;
