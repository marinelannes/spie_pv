import { count } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type { AppConfig } from "./config.js";
import type { Db } from "./db/client.js";
import { utilisateurs } from "./db/schema.js";
import { createUser } from "./services/users.js";

/**
 * Crée le premier administrateur si la base ne contient aucun compte et que BOOTSTRAP_ADMIN_* est défini.
 * Le mot de passe est provisoire : il doit être changé à la première connexion.
 */
export async function bootstrapAdmin(db: Db, config: AppConfig, log: FastifyBaseLogger): Promise<void> {
  if (!config.bootstrapAdmin) return;
  const [row] = await db.select({ n: count() }).from(utilisateurs);
  if (Number(row?.n ?? 0) > 0) return;
  const { email, nom, password } = config.bootstrapAdmin;
  await createUser(db, { email, nom, role: "admin", password });
  log.info({ email }, "premier administrateur créé (mot de passe provisoire à changer à la première connexion)");
}
