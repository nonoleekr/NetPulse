import { app } from "./app.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { startScheduler, stopScheduler } from "./scheduler.js";

const server = app.listen(config.port, "127.0.0.1", () => {
  console.log(`NetPulse API listening on http://localhost:${config.port}`);
});

await startScheduler();

async function shutdown() {
  stopScheduler();
  server.close();
  await prisma.$disconnect();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
