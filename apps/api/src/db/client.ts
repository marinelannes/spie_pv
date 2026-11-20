import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema.js";

export type Schema = typeof schema;
export type Db = PgDatabase<PgQueryResultHKT, Schema>;

export interface DbHandle {
  db: Db;
  kind: "postgres" | "pglite";
  migrate(): Promise<void>;
  /**
   * Exécute `fn` en exclusion mutuelle avec les autres processus sur la même base (plusieurs réplicas de l'API
   * qui démarrent ensemble). À utiliser pour les migrations et l'initialisation des données.
   */
  withStartupLock<T>(fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/**
 * Ouvre la base. `postgres://…` en recette et production ; `pglite://<dossier>` ou `pglite://memory`
 * pour le développement sans Docker et pour les tests (PostgreSQL compilé en WebAssembly).
 */
export async function openDatabase(url: string): Promise<DbHandle> {
  const migrationsFolder = findMigrationsFolder();

  if (url.startsWith("pglite:")) {
    const [{ PGlite }, { drizzle }, { migrate }] = await Promise.all([
      import("@electric-sql/pglite"),
      import("drizzle-orm/pglite"),
      import("drizzle-orm/pglite/migrator"),
    ]);
    const target = url.slice("pglite:".length).replace(/^\/\//, "");
    const client = target === "" || target === "memory" ? new PGlite() : new PGlite(target);
    const db = drizzle(client, { schema });
    return {
      db: db as unknown as Db,
      kind: "pglite",
      migrate: () => migrate(db, { migrationsFolder }),
      // PGlite est embarqué dans un seul processus : rien à sérialiser.
      withStartupLock: (fn) => fn(),
      close: () => client.close(),
    };
  }

  const [{ default: pg }, { drizzle }, { migrate }] = await Promise.all([
    import("pg"),
    import("drizzle-orm/node-postgres"),
    import("drizzle-orm/node-postgres/migrator"),
  ]);
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  const db = drizzle(pool, { schema });
  return {
    db: db as unknown as Db,
    kind: "postgres",
    migrate: () => migrate(db, { migrationsFolder }),
    async withStartupLock(fn) {
      // Verrou consultatif de session sur une connexion dédiée : les autres réplicas attendent ici
      // pendant que le premier applique les migrations et crée l'administrateur initial.
      const lockClient = await pool.connect();
      try {
        await lockClient.query("select pg_advisory_lock($1)", [STARTUP_LOCK_KEY]);
        return await fn();
      } finally {
        await lockClient.query("select pg_advisory_unlock($1)", [STARTUP_LOCK_KEY]).catch(() => undefined);
        lockClient.release();
      }
    },
    close: () => pool.end(),
  };
}

/** Clé du verrou consultatif PostgreSQL qui sérialise l'initialisation entre réplicas (valeur arbitraire, fixe). */
const STARTUP_LOCK_KEY = 735_173_001;

/** Le dossier `drizzle/` est à côté de `src/` (sources) ou de `dist/` (bundle) : on le cherche en remontant. */
function findMigrationsFolder(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, "drizzle");
    if (existsSync(join(candidate, "meta", "_journal.json"))) return candidate;
    dir = dirname(dir);
  }
  throw new Error("Dossier des migrations « drizzle/ » introuvable.");
}
