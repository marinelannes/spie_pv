import { buildApp } from "./app.js";
import { bootstrapAdmin } from "./bootstrap.js";
import { loadConfig, loadDotEnvForDev } from "./config.js";
import { openDatabase } from "./db/client.js";
import { createSharePointClient } from "./sharepoint/index.js";

loadDotEnvForDev();
const config = loadConfig();
const database = await openDatabase(config.databaseUrl);
await database.migrate();

const app = await buildApp({
  config,
  db: database.db,
  sharepoint: createSharePointClient(config.sharepoint),
  version: process.env.APP_VERSION ?? "dev",
  logger:
    config.env === "development"
      ? { level: config.logLevel, transport: { target: "pino-pretty", options: { translateTime: "SYS:HH:MM:ss" } } }
      : { level: config.logLevel },
});
app.log.info({ base: database.kind, sharepoint: config.sharepoint.mode }, "migrations appliquées");
await bootstrapAdmin(database.db, config, app.log);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "arrêt");
  await app.close();
  await database.close();
  process.exit(0);
};
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ host: config.host, port: config.port });
