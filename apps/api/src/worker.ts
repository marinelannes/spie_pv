import { loadConfig, loadDotEnvForDev } from "./config.js";
import { openDatabase } from "./db/client.js";
import { generateurParDefaut } from "./services/generateur-defaut.js";
import { TraitementDepots, type LoggerLike } from "./services/traitement.js";
import { createSharePointClient } from "./sharepoint/index.js";
import { createFileArchive } from "./storage/archive.js";

/**
 * Worker (même image que l'API, commande `node dist/worker.js`) : génération des PDF / JSON / XLSX et dépôt
 * SharePoint avec reprises (1 min, 5 min, 30 min, 2 h, 6 h — spec §5.4). La file est la table `depot` de PostgreSQL
 * (réservation `FOR UPDATE SKIP LOCKED`) : plusieurs workers peuvent tourner sans traiter deux fois le même dépôt.
 */
loadDotEnvForDev();
const config = loadConfig();
if (!config.databaseUrl.startsWith("postgres")) {
  console.error(
    "Le worker nécessite PostgreSQL (DATABASE_URL=postgres://…). Avec PGlite, l'API traite elle-même les dépôts (WORKER_INLINE).",
  );
  process.exit(1);
}

const ecrire = (level: string) => (obj: object, msg: string) =>
  console.log(JSON.stringify({ level, time: new Date().toISOString(), msg, ...obj }));
const log: LoggerLike = { info: ecrire("info"), warn: ecrire("warn"), error: ecrire("error") };

const database = await openDatabase(config.databaseUrl);
// Les migrations sont appliquées par l'API ; le worker attend qu'elles le soient (même verrou de démarrage).
await database.withStartupLock(() => database.migrate());

const traitement = new TraitementDepots({
  db: database.db,
  sharepoint: createSharePointClient(config.sharepoint),
  archive: createFileArchive(config.archive),
  fichiers: generateurParDefaut(config),
  now: () => new Date(),
  createMissingFolders: config.sharepointCreateMissingFolders,
  log,
});
traitement.demarrer(config.workerPollMs);
log.info({ version: process.env.APP_VERSION ?? "dev", intervalle: config.workerPollMs }, "worker démarré");

const shutdown = async (signal: string) => {
  log.info({ signal }, "arrêt du worker");
  await traitement.arreter();
  await database.close();
  process.exit(0);
};
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
