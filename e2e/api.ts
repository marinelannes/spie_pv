import type { APIRequestContext } from "@playwright/test";
import { ADMIN, AFFAIRE, RELAIS, TECHNICIEN, classeurEs } from "./donnees";

/**
 * Préparation des données par l'API HTTP, comme le ferait le bureau depuis le back-office : les tests de bout en bout
 * portent ensuite sur ce que voit le technicien sur sa tablette.
 */

/** Appelle l'API et renvoie le JSON de la réponse ; échoue avec un message lisible si le statut n'est pas 2xx. */
async function appel<T>(
  api: APIRequestContext,
  methode: "get" | "post" | "put",
  url: string,
  jeton: string | null,
  data?: unknown,
): Promise<T> {
  const reponse = await api[methode](url, {
    headers: jeton ? { authorization: `Bearer ${jeton}` } : {},
    data,
  });
  if (!reponse.ok()) throw new Error(`${methode.toUpperCase()} ${url} → ${reponse.status()} ${await reponse.text()}`);
  return reponse.status() === 204 ? (undefined as T) : ((await reponse.json()) as T);
}

export async function connexionApi(api: APIRequestContext, email: string, password: string): Promise<string> {
  const session = await appel<{ accessToken: string }>(api, "post", "/api/auth/login", null, { email, password });
  return session.accessToken;
}

/** Remplace un mot de passe provisoire (obligatoire avant toute autre action). */
async function changerMotDePasse(api: APIRequestContext, email: string, provisoire: string, definitif: string) {
  const jeton = await connexionApi(api, email, provisoire);
  await appel(api, "post", "/api/auth/change-password", jeton, { currentPassword: provisoire, newPassword: definitif });
}

/** Une fois par exécution : l'administrateur active son compte, puis crée le compte du technicien. */
export async function creerLesComptes(api: APIRequestContext): Promise<void> {
  await changerMotDePasse(api, ADMIN.email, ADMIN.motDePasseProvisoire, ADMIN.motDePasse);
  const admin = await connexionApi(api, ADMIN.email, ADMIN.motDePasse);
  const cree = await appel<{ temporaryPassword: string }>(api, "post", "/api/admin/users", admin, {
    email: TECHNICIEN.email,
    nom: TECHNICIEN.nom,
    role: "technicien",
  });
  await changerMotDePasse(api, TECHNICIEN.email, cree.temporaryPassword, TECHNICIEN.motDePasse);
}

export interface AffaireDeTest {
  id: string;
  numero: string;
}

interface DossierSharePoint {
  id: string;
  driveId: string;
  name: string;
}

let compteur = 0;

/**
 * Crée une affaire neuve, affectée au technicien, avec sa liste d'E/S (un relais, quatre E/S).
 * Chaque test a la sienne : les tests ne dépendent pas les uns des autres.
 */
export async function creerAffaire(api: APIRequestContext): Promise<AffaireDeTest> {
  const admin = await connexionApi(api, ADMIN.email, ADMIN.motDePasse);
  const numero = `DEMO-${Date.now().toString(36).toUpperCase()}-${++compteur}`;

  // Dossier de dépôt : le premier dossier de la première bibliothèque du SharePoint simulé.
  const parcourir = "/api/admin/sharepoint/browse";
  const bibliotheques = await appel<{ items: DossierSharePoint[] }>(api, "get", parcourir, admin);
  const driveId = bibliotheques.items[0]!.driveId;
  const racine = await appel<{ items: DossierSharePoint[] }>(api, "get", `${parcourir}?driveId=${driveId}`, admin);
  const dossier = racine.items[0]!;

  const affaire = await appel<{ id: string }>(api, "post", "/api/admin/affaires", admin, {
    ...AFFAIRE,
    numero,
    dossierSharePoint: { driveId, itemId: dossier.id, path: dossier.name, webUrl: null },
  });
  const utilisateurs = await appel<{ id: string; email: string }[]>(api, "get", "/api/admin/users", admin);
  const technicien = utilisateurs.find((u) => u.email === TECHNICIEN.email)!;
  await appel(api, "put", `/api/admin/affaires/${affaire.id}/affectations`, admin, { userIds: [technicien.id] });
  await appel(api, "post", `/api/prep/affaires/${affaire.id}/io-lists`, admin, {
    fichier: "DEMO_AUT_001_LISTE_ES.xlsx",
    contenuBase64: await classeurEs(numero),
  });
  return { id: affaire.id, numero };
}

/** Le bureau prépare un PV pour le relais de l'affaire et l'affecte au technicien. */
export async function preparerPv(api: APIRequestContext, affaire: AffaireDeTest): Promise<{ numero: string }> {
  const admin = await connexionApi(api, ADMIN.email, ADMIN.motDePasse);
  const prep = await appel<{ equipements: { id: string; tag: string }[] }>(
    api,
    "get",
    `/api/prep/affaires/${affaire.id}`,
    admin,
  );
  const relais = prep.equipements.find((e) => e.tag === RELAIS.tag)!;
  const pv = await appel<{ pvId: string; numero: string }>(api, "post", "/api/prep/pv", admin, {
    affaireId: affaire.id,
    equipementId: relais.id,
  });
  const utilisateurs = await appel<{ id: string; email: string }[]>(api, "get", "/api/admin/users", admin);
  const technicien = utilisateurs.find((u) => u.email === TECHNICIEN.email)!;
  await appel(api, "put", `/api/prep/pv/${pv.pvId}/affectations`, admin, { userIds: [technicien.id] });
  return { numero: pv.numero };
}
