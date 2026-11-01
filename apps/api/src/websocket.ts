import type { Duplex } from "node:stream";
import type { Server as HttpServer, IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { WebSocketEvent } from "@netpulse/contracts";
import { config } from "./config.js";
import { measurementEvents } from "./measurement-events.js";

const clients = new Set<WebSocket>();
const aliveClients = new WeakMap<WebSocket, boolean>();

function isAllowedOrigin(request: IncomingMessage) {
  const origin = request.headers.origin;
  return !origin || origin === config.webOrigin;
}

export function createWebSocketServer(server: HttpServer) {
  const websocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: config.maxWebSocketPayloadBytes,
  });
  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (aliveClients.get(client) === false) {
        client.terminate();
        clients.delete(client);
        continue;
      }
      aliveClients.set(client, false);
      client.ping();
    }
  }, 30_000);

  const handleUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (request.url !== "/ws" || !isAllowedOrigin(request)) {
      socket.destroy();
      return;
    }
    if (clients.size >= config.maxWebSocketClients) {
      socket.destroy();
      return;
    }
    websocketServer.handleUpgrade(request, socket, head, (client) => {
      websocketServer.emit("connection", client, request);
    });
  };

  server.on("upgrade", handleUpgrade);
  websocketServer.on("connection", (client) => {
    clients.add(client);
    aliveClients.set(client, true);
    client.on("pong", () => { aliveClients.set(client, true); });
    const readyEvent: WebSocketEvent = {
      type: "connection.ready",
      occurredAt: new Date().toISOString(),
      payload: { protocolVersion: 1 },
    };
    client.send(JSON.stringify(readyEvent));
    client.on("close", () => { clients.delete(client); aliveClients.delete(client); });
    client.on("error", () => { clients.delete(client); aliveClients.delete(client); });
  });
  const broadcastMeasurement = (event: WebSocketEvent) => {
    const message = JSON.stringify(event);
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) client.send(message);
    }
  };
  measurementEvents.on("event", broadcastMeasurement);

  return {
    broadcast(event: WebSocketEvent) {
      const message = JSON.stringify(event);
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) client.send(message);
      }
    },
    close() {
      server.off("upgrade", handleUpgrade);
      measurementEvents.off("event", broadcastMeasurement);
      for (const client of clients) client.close(1001, "Server shutting down");
      clients.clear();
      clearInterval(heartbeat);
      websocketServer.close();
    },
  };
}
