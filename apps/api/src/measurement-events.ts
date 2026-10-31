import { EventEmitter } from "node:events";
import type { WebSocketEvent } from "@netpulse/contracts";

export const measurementEvents = new EventEmitter();

export function emitMeasurementCompleted(event: WebSocketEvent) {
  measurementEvents.emit("measurement.completed", event);
}
