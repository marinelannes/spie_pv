import { buildApp } from "./app.js";
import { bootstrapAdmin } from "./bootstrap.js";
import { loadConfig, loadDotEnvForDev } from "./config.js";
import { openDatabase } from "./db/client.js";
import { createSharePointClient } from "./sharepoint/index.js";

loadDotEnvForDev();
const config = loadConfig();
const database = await openDatabase(config.databaseUrl);

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
// Plusieurs réplicas peuvent démarrer ensemble : un seul applique les migrations et crée l'admin initial.
await database.withStartupLock(async () => {
  await database.migrate();
  await bootstrapAdmin(database.db, config, app.log);
});
app.log.info({ base: database.kind, sharepoint: config.sharepoint.mode }, "migrations appliquées");
if (config.workerInline) {
  // Développement (PGlite, un seul processus) : l'API traite elle-même la file des dépôts.
  app.ctx.traitement.demarrer(config.workerPollMs);
  app.log.info({ intervalle: config.workerPollMs }, "traitement des dépôts dans le processus de l'API");
}

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "arrêt");
  await app.close();
  await database.close();
  process.exit(0);
};
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ host: config.host, port: config.port });
