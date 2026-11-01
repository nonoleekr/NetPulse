import { app } from "./app.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { startScheduler, stopScheduler } from "./scheduler.js";
import { createWebSocketServer } from "./websocket.js";
import { logger } from "./logger.js";

const server = app.listen(config.port, config.host, () => {
  logger.info("server.started", { host: config.host, port: config.port });
});
const websocket = createWebSocketServer(server);

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  stopScheduler();
  websocket.close();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await prisma.$disconnect();
}

let shuttingDown = false;
const handleShutdown = () => {
  if (shuttingDown) return;
  void shutdown().catch((error) => {
    logger.error("server.shutdown_failed", { error: error instanceof Error ? error.message : "Unknown error" });
    process.exitCode = 1;
  });
};

try {
  await startScheduler();
} catch (error) {
  logger.error("server.startup_failed", { error: error instanceof Error ? error.message : "Unknown error" });
  handleShutdown();
}

process.once("SIGINT", handleShutdown);
process.once("SIGTERM", handleShutdown);
process.on("uncaughtException", (error) => {
  logger.error("process.uncaught_exception", { error: error.message });
  handleShutdown();
});
process.on("unhandledRejection", (reason) => {
  logger.error("process.unhandled_rejection", { error: reason instanceof Error ? reason.message : String(reason) });
});
