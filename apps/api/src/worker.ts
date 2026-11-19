import PgBoss from "pg-boss";
import { loadConfig, loadDotEnvForDev } from "./config.js";

/**
 * Worker (même image que l'API, commande `node dist/worker.js`). File de tâches pg-boss dans PostgreSQL.
 * Lot 0 : démarrage et connexion à la file uniquement. Lot 1 : génération des PDF/XLSX et dépôt
 * SharePoint avec reprises (1 min, 5 min, 30 min, 2 h, 6 h — spec §5.4).
 */
loadDotEnvForDev();
const config = loadConfig();
if (!config.databaseUrl.startsWith("postgres")) {
  console.error("Le worker nécessite PostgreSQL (DATABASE_URL=postgres://…) : pg-boss ne fonctionne pas sur PGlite.");
  process.exit(1);
}

const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ level: "info", time: new Date().toISOString(), msg, ...extra }));

const boss = new PgBoss({ connectionString: config.databaseUrl, schema: "pgboss" });
boss.on("error", (err) => console.error(JSON.stringify({ level: "error", msg: "pg-boss", err: String(err) })));
await boss.start();
log("worker démarré", { version: process.env.APP_VERSION ?? "dev" });

const shutdown = async (signal: string) => {
  log("arrêt du worker", { signal });
  await boss.stop({ graceful: true, timeout: 30_000 });
  process.exit(0);
};
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
