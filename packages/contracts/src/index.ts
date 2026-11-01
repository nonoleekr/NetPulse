export const websocketEventTypes = [
  "connection.ready",
  "measurement.completed",
  "outage.started",
  "outage.recovered",
  "monitor.status_changed",
] as const;

export type MeasurementCompletedPayload = {
  monitorId: string;
  measurementId: string;
  completedAt: string;
  success: boolean;
};

export type OutagePayload = {
  monitorId: string;
  outageId: string;
  occurredAt: string;
  startedAt: string;
  endedAt: string | null;
  failureCount: number;
  reason: string | null;
};

export type MonitorStatusPayload = {
  monitorId: string;
  status: "UP" | "DOWN" | "PAUSED" | "UNKNOWN";
};

export type WebSocketEvent =
  | {
      type: "connection.ready";
      occurredAt: string;
      payload: { protocolVersion: 1 };
    }
  | {
      type: "measurement.completed";
      occurredAt: string;
      payload: MeasurementCompletedPayload;
    }
  | {
      type: "outage.started" | "outage.recovered";
      occurredAt: string;
      payload: OutagePayload;
    }
  | {
      type: "monitor.status_changed";
      occurredAt: string;
      payload: MonitorStatusPayload;
    };
