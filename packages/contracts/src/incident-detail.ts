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
  const timelineEventsById = new Map<string, IncidentEvent>();
  for (const [index, event] of timeline.entries()) {
    if (event.incidentId.toLowerCase() !== incidentId) {
      context.addIssue({
        code: "custom",
        path: ["timeline", index, "incidentId"],
        message: "timeline incidentId must match envelope incident id",
      });
    }
    const eventId = event.id.toLowerCase();
    if (timelineEventsById.has(eventId)) {
      context.addIssue({
        code: "custom",
        path: ["timeline", index, "id"],
        message: "timeline event ids must be unique",
      });
    } else {
      timelineEventsById.set(eventId, event);
    }
  }

  const deliveriesById = new Map<string, NotificationDelivery>();
  for (const [index, delivery] of deliveries.entries()) {
    const sourceEvent = timelineEventsById.get(delivery.incidentEventId.toLowerCase());
    if (sourceEvent === undefined) {
      context.addIssue({
        code: "custom",
        path: ["deliveries", index, "incidentEventId"],
        message: "delivery incidentEventId must reference a timeline event",
      });
    } else if (sourceEvent.type !== "opened" && sourceEvent.type !== "resolved") {
      context.addIssue({
        code: "custom",
        path: ["deliveries", index, "incidentEventId"],
        message: "delivery incidentEventId must reference an opened or resolved timeline event",
      });
    }
    const deliveryId = delivery.id.toLowerCase();
    if (deliveriesById.has(deliveryId)) {
      context.addIssue({
        code: "custom",
        path: ["deliveries", index, "id"],
        message: "delivery ids must be unique",
      });
    } else {
      deliveriesById.set(deliveryId, delivery);
    }
  }

  for (const [index, event] of timeline.entries()) {
    if (event.type !== "notification_queued") {
      continue;
    }
    const delivery = deliveriesById.get(event.details.deliveryId.toLowerCase());
    if (delivery === undefined) {
      context.addIssue({
        code: "custom",
        path: ["timeline", index, "details", "deliveryId"],
        message: "notification_queued deliveryId must reference an envelope delivery",
      });
    } else if (event.details.channelId.toLowerCase() !== delivery.channelId.toLowerCase()) {
      context.addIssue({
        code: "custom",
        path: ["timeline", index, "details", "channelId"],
        message: "notification_queued channelId must match delivery channelId",
      });
    }
  }
}) satisfies z.ZodType<{
  incident: Incident;
  timeline: IncidentEvent[];
  deliveries: NotificationDelivery[];
}>;
export type IncidentDetailResponse = z.infer<typeof IncidentDetailResponseSchema>;
