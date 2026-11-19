import { parseArgs } from "node:util";
import { createUserRequestSchema } from "@spie/shared";
import { loadConfig, loadDotEnvForDev } from "./config.js";
import { openDatabase } from "./db/client.js";
import { createUser, findUserByEmail, resetPassword } from "./services/users.js";

/**
 * Commandes d'exploitation, par exemple dans le conteneur : `node dist/cli.js create-admin --email … --name "…"`.
 * Le mot de passe provisoire est affiché une seule fois et devra être changé à la première connexion.
 */
const USAGE = `Usage :
  cli create-admin --email <e-mail> --name "<nom>"   Crée un administrateur
  cli reset-password --email <e-mail>                Nouveau mot de passe provisoire (déverrouille le compte)`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { email: { type: "string" }, name: { type: "string" } },
});

loadDotEnvForDev();
const config = loadConfig();
const database = await openDatabase(config.databaseUrl);
await database.migrate();

try {
  switch (positionals[0]) {
    case "create-admin": {
      const input = createUserRequestSchema.parse({ email: values.email, nom: values.name, role: "admin" });
      const { user, temporaryPassword } = await createUser(database.db, input);
      console.log(`Administrateur créé : ${user.email}\nMot de passe provisoire : ${temporaryPassword}`);
      break;
    }
    case "reset-password": {
      const user = values.email ? await findUserByEmail(database.db, values.email) : undefined;
      if (!user) throw new Error(`Aucun compte pour « ${values.email ?? ""} ».`);
      const { temporaryPassword } = await resetPassword(database.db, user.id, new Date());
      console.log(`Mot de passe réinitialisé : ${user.email}\nMot de passe provisoire : ${temporaryPassword}`);
      break;
    }
    default:
      console.log(USAGE);
      process.exitCode = 1;
  }
} catch (err) {
  console.error(`Erreur : ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await database.close();
}
