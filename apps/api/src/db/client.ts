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
    close: () => pool.end(),
  };
}

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
