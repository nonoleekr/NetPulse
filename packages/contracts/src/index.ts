export const websocketEventTypes = ["connection.ready", "measurement.completed"] as const;

export type MeasurementCompletedPayload = {
  monitorId: string;
  measurementId: string;
  completedAt: string;
  success: boolean;
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
    };
