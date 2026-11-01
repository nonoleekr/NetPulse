import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import process from "node:process";

const databasePath = "apps/api/e2e.db";
rmSync(databasePath, { force: true });
rmSync(`${databasePath}-journal`, { force: true });
const databaseUrl = `file:${process.cwd().replaceAll("\\", "/")}/${databasePath}`;

const environment = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  HOST: "127.0.0.1",
  PORT: "4000",
  WEB_ORIGIN: "http://127.0.0.1:5173",
  NODE_ENV: "test",
  NETPULSE_ALLOW_LOCAL_TARGETS: "true",
};

const migration = process.platform === "win32"
  ? spawnSync(
      process.env.ComSpec ?? "cmd.exe",
      ["/d", "/s", "/c", "npx prisma migrate deploy --config apps/api/prisma.config.ts"],
      { env: environment, stdio: "inherit" },
    )
  : spawnSync(
      "npx",
      ["prisma", "migrate", "deploy", "--config", "apps/api/prisma.config.ts"],
      { env: environment, stdio: "inherit" },
    );
if (migration.error) {
  console.error("Unable to run Prisma migrations:", migration.error);
  process.exit(1);
}
if (migration.status !== 0) process.exit(migration.status ?? 1);

process.env = environment;
await import("../apps/api/dist/server.js");
