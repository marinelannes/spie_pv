# spie-pv — Plateforme tablette de saisie des PV SPIE

Monorepo de la PWA technicien, du back-office et de l'API décrits dans [`../spec.md`](../spec.md) (v0.4).
Ce dépôt contient le **lot 0 — Socle** (spec §11).

## Lot 0 — contenu

| Élément de la spec                          | Où                                                                                    | État                                                                                                                                                                                                                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo pnpm (§8.3)                        | `apps/web`, `apps/api`, `packages/shared`, `packages/templates`, `packages/io-import` | Fait. `templates` et `io-import` sont des emplacements vides pour le lot 1                                                                                                                                                                                                            |
| Comptes et authentification (§7.1, §7.2)    | `apps/api/src/routes/auth.ts`                                                         | Fait : argon2id, 12 caractères min., mot de passe provisoire à changer, verrouillage 15 min après 5 échecs, jeton d'accès 15 min, jeton de rafraîchissement rotatif 30 jours en cookie `HttpOnly; Secure; SameSite=Strict`, détection de réutilisation, révocation à la désactivation |
| Autorisations (§7.3)                        | `apps/api/src/plugins/auth.ts`                                                        | Fait : contrôle à chaque requête, `/api/admin/*` réservé aux administrateurs, `/api/affaires` filtré par affectation                                                                                                                                                                  |
| Back-office utilisateurs et affaires (§4.6) | `apps/web/src/pages/admin`                                                            | Fait : comptes (création, rôle, désactivation, réinitialisation), affaires (création, modification, archivage, noms par défaut, affectations, dossier SharePoint choisi en parcourant le site), journal d'audit                                                                       |
| SharePoint (§5.4)                           | `apps/api/src/sharepoint`                                                             | Fait : client Graph (certificat, `conflictBehavior=fail`, envoi simple < 4 Mo, session d'envoi au-delà), navigation dans le site, **dépôt de test**                                                                                                                                   |
| Infra Azure de recette (§8.6)               | `infra/`                                                                              | Bicep, voir [`docs/infra.md`](docs/infra.md)                                                                                                                                                                                                                                          |
| App registration SharePoint                 | `infra/sharepoint/`                                                                   | Scripts + note pour la DSI : [`docs/sharepoint-dsi.md`](docs/sharepoint-dsi.md)                                                                                                                                                                                                       |
| CI/CD                                       | `.github/workflows/`                                                                  | GitHub Actions (hypothèse, point ouvert n°4)                                                                                                                                                                                                                                          |

**Critère de fin du lot 0** : « un fichier de test est déposé dans le site SharePoint cible depuis l'API de recette ».
Le bouton **Back-office › SharePoint › Déposer un fichier de test** (ou sur la fiche d'une affaire) le fait.
Il est vérifié en local sur le SharePoint simulé ; sur le vrai site, il reste bloqué par les points ouverts n°1 à 3
(site cible, accord DSI pour l'app registration, souscription Azure).

## Démarrer en local

Prérequis : **Node 24** (22.12 minimum, voir `.nvmrc`) et pnpm 9 (`corepack enable`).
Aucune base à installer : l'API utilise PGlite (PostgreSQL embarqué) et un SharePoint simulé par défaut.

```powershell
pnpm install
Copy-Item apps/api/.env.example apps/api/.env
pnpm dev
```

- PWA et back-office : <http://localhost:5173> (Vite, proxy `/api` vers l'API)
- API : <http://localhost:3000/api/health>
- Premier compte : l'administrateur défini par `BOOTSTRAP_ADMIN_*` dans `apps/api/.env`, créé au premier démarrage si la base est vide. Son mot de passe est provisoire.
- Les fichiers « déposés » en mode simulé sont dans `apps/api/.data/sharepoint/`.

Avec un vrai PostgreSQL : `docker compose up -d` puis `DATABASE_URL=postgres://spie:spie@localhost:5432/spiepv` dans `apps/api/.env`.

## Commandes

| Commande                                             | Rôle                                                                              |
| ---------------------------------------------------- | --------------------------------------------------------------------------------- |
| `pnpm dev`                                           | API (`tsx watch`) + PWA (Vite)                                                    |
| `pnpm test`                                          | Tests Vitest (API sur PGlite en mémoire, aucun service externe)                   |
| `pnpm typecheck` / `pnpm lint`                       | Contrôles TypeScript et ESLint                                                    |
| `pnpm build`                                         | Bundle API (`apps/api/dist`) + PWA (`apps/web/dist`)                              |
| `pnpm --filter @spie/api db:generate --name <nom>`   | Nouvelle migration Drizzle après modification de `apps/api/src/db/schema.ts`      |
| `node dist/cli.js create-admin --email … --name "…"` | Dans le conteneur : crée un administrateur et affiche son mot de passe provisoire |
| `node dist/cli.js reset-password --email …`          | Dans le conteneur : nouveau mot de passe provisoire (déverrouille le compte)      |

## Configuration de l'API

Variables principales (toutes dans `apps/api/src/config.ts`) :

| Variable                                                                                            | Défaut hors production  | Production                                      |
| --------------------------------------------------------------------------------------------------- | ----------------------- | ----------------------------------------------- |
| `DATABASE_URL`                                                                                      | `pglite://.data/pglite` | Obligatoire (`postgres://…?sslmode=require`)    |
| `JWT_SECRET`                                                                                        | clé de développement    | Obligatoire, ≥ 32 caractères (Key Vault)        |
| `SHAREPOINT_MODE`                                                                                   | `fake`                  | `graph`                                         |
| `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CERT_PEM` (ou `GRAPH_CERT_PATH`), `SHAREPOINT_SITE_ID` | —                       | Obligatoires en mode `graph`                    |
| `COOKIE_SECURE`, `TRUST_PROXY`                                                                      | `false`                 | `true`                                          |
| `WEB_DIST_DIR`                                                                                      | —                       | `/app/public` (l'API sert la PWA, même origine) |
| `BOOTSTRAP_ADMIN_EMAIL` / `_NAME` / `_PASSWORD`                                                     | —                       | Facultatif                                      |

## Choix d'implémentation à valider

- **Microsoft Graph** est appelé par un petit client `fetch` + `@azure/identity` (certificat) plutôt que par le SDK Graph : mêmes routes, moins de dépendances, et testable sans tenant (`apps/api/test/graph.test.ts`).
- **Verrouillage** : 15 minutes après 5 échecs (durée non précisée par la spec, paramétrable : `LOGIN_LOCK_MINUTES`).
- **Rotation des jetons** : un jeton de rafraîchissement remplacé reste accepté 10 s (deux onglets qui rafraîchissent ensemble) ; au-delà, sa réutilisation révoque toutes les sessions issues de la même connexion.
- **Node 22.12 minimum** : `@fastify/cookie` dépend de `cookie@2`, publié uniquement en module ES. La production tourne en Node 24.
- **Worker** : démarre pg-boss et attend ; les tâches (PDF, dépôt avec reprises) arrivent au lot 1.
- **Icônes PWA** provisoires (`apps/web/scripts/generate-icons.mjs`), à remplacer par le logo SPIE validé.
