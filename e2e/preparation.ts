import { request } from "@playwright/test";
import { creerLesComptes } from "./api";
import { PORT } from "./donnees";

/** Exécuté une fois, serveur démarré, avant tous les tests : création des comptes fictifs. */
export default async function preparation(): Promise<void> {
  const api = await request.newContext({ baseURL: `http://127.0.0.1:${PORT}` });
  await creerLesComptes(api);
  await api.dispose();
}
