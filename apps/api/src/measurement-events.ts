import { EventEmitter } from "node:events";
import type { WebSocketEvent } from "@netpulse/contracts";

export const measurementEvents = new EventEmitter();

export function emitMeasurementCompleted(event: WebSocketEvent) {
  measurementEvents.emit("event", event);
  measurementEvents.emit("measurement.completed", event);
}

export function emitMonitoringEvent(event: WebSocketEvent) {
  measurementEvents.emit("event", event);
}
