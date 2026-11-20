# spie-pv — Plateforme tablette de saisie des PV SPIE

Monorepo de la PWA technicien, du back-office et de l'API décrits dans [`docs/spec.md`](docs/spec.md) (v0.4).
Ce dépôt contient le **lot 0 — Socle**, le **lot 1 — PV de test relais de protection** et le **lot 2 — Révisions et
réserves** (spec §11).

## Lot 0 — contenu

| Élément de la spec                          | Où                                                                                    | État                                                                                                                                                                                                                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo pnpm (§8.3)                        | `apps/web`, `apps/api`, `packages/shared`, `packages/templates`, `packages/io-import` | Fait                                                                                                                                                                                                                                                                                  |
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

## Lot 1 — contenu

| Élément de la spec                                                      | Où                                                                           | État                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Modèle de données du PV relais, règles de saisie (§4.1–4.3, §4.5)       | `packages/shared/src/pv-*.ts`                                                | Schéma zod unique (préparation, tablette, serveur, PDF), contenu par défaut repris du Word, numérotation `<affaire>-<AAAAMMJJ>-<HHMMSS>` (heure de Paris, une seconde par PV et par poste), nommage `PV_MES_<tag>_<numéro>_ind<indice>`, contrôles avant signature, observations et réserves, valeurs préparées modifiées sur site, empreinte SHA-256 (JSON canonique, WebCrypto) |
| Import des listes E/S et des équipements (§4.4)                         | `packages/io-import`, `apps/api/src/services/io-listes.ts`                   | Lecture exceljs, normalisation des types, réserves cochées NA, anomalies ligne par ligne, association équipement ↔ feuille (auto par TYPE CELLULE, sinon choix du préparateur, **filtre TAG** pour une feuille partagée), versions successives de la liste                                                                                                                        |
| Préparation des PV, duplication, affectation (§3.1, §4.6)               | `apps/api/src/routes/prep.ts`, back-office `apps/web`                        | Création par équipement, même formulaire qu'en saisie (mode « préparation »), duplication vers d'autres équipements, techniciens affectés, suivi filtrable                                                                                                                                                                                                                        |
| Saisie hors ligne, E/S et SCADA, signatures, BPO / BPE / CMS (§3.2, §6) | `apps/web`                                                                   | IndexedDB (Dexie, une base par utilisateur), file d'envoi idempotente, synchronisation à l'ouverture, au retour du réseau, toutes les 2 min et par bouton                                                                                                                                                                                                                         |
| PDF fidèle, XLSX, JSON (§5.1, §8.2)                                     | `packages/templates`, `apps/api/src/pdf`, `packages/io-import/src/export.ts` | React → HTML + CSS d'impression, Paged.js (en-têtes, « Page x sur y », sommaire paginé, en-têtes de tableau répétés), Chromium ; même rendu pour l'aperçu hors ligne                                                                                                                                                                                                              |
| Dépôt SharePoint avec reprises (§3.3, §5.2–5.4)                         | `apps/api/src/services/traitement.ts`, `apps/api/src/worker.ts`              | Dossier de l'affaire + chemin relatif de la famille, sous-dossiers créés au besoin, jamais d'écrasement, copie d'archive (Blob), reprises 1 min / 5 min / 30 min / 2 h / 6 h puis Erreur, relance par l'administrateur                                                                                                                                                            |

**Critère de fin du lot 1** : « la liste GAU11_AUT_009 est importée. Un PV est préparé pour un relais, complété en mode
avion, signé, puis déposé automatiquement au retour du réseau. PDF validé par SPIE face au modèle Word ».
Côté API, `apps/api/test/gau11.test.ts` rejoue l'import du vrai fichier (366 E/S, 12 équipements), la préparation,
la duplication vers les 5 départs batterie, la signature et le dépôt. Le fichier client n'est pas versionné : le test le
lit à côté du dépôt (`../GAU11_AUT_009_LISTE ENTREES SORTIES RPN_B.xlsx`) ou via `SPIE_IO_FIXTURE`, et il est sauté
s'il est absent. La validation du PDF par SPIE reste à faire.

### Routes ajoutées (spec §8.5)

| Route                                                                                    | Rôle                                                                                  |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `GET /api/sync/reference`, `POST /api/sync/started`                                      | Référentiel de la tablette ; PV préparés dont la saisie a commencé                    |
| `PUT /api/pv-versions/{uuid}`, `GET /api/pv-versions/{uuid}/status`                      | Envoi idempotent d'un PV signé (empreinte vérifiée), statut de traitement et de dépôt |
| `GET /api/prep/affaires`, `GET /api/prep/affaires/{id}`                                  | Affaires du préparateur, fiche (équipements, versions de liste, PV, techniciens)      |
| `POST /api/prep/affaires/{id}/io-lists/analyse`, `POST /api/prep/affaires/{id}/io-lists` | Analyse (rapport d'anomalies, associations proposées) puis import d'une liste E/S     |
| `GET /api/prep/io-lists/{id}`, `PUT /api/prep/equipements/{id}/association`              | Détail d'une version de liste ; feuille et filtre TAG d'un équipement                 |
| `GET/POST /api/prep/pv`, `GET/PUT/DELETE /api/prep/pv/{id}`                              | Suivi, création et préparation des PV                                                 |
| `PUT /api/prep/pv/{id}/affectations`, `POST /api/prep/pv/{id}/duplicate`                 | Techniciens du PV ; duplication vers d'autres équipements                             |
| `GET /api/prep/versions/{id}/fichiers/{pdf,json,xlsx}`                                   | Fichiers produits (copie d'archive)                                                   |
| `GET /api/admin/depots`, `POST /api/admin/depots/{id}/retry`                             | Dépôts (alerte sur les erreurs) et relance                                            |
| `GET/PUT /api/admin/sharepoint/familles`                                                 | Chemin relatif de chaque famille de PV sous le dossier de l'affaire                   |

### Écrans ajoutés à la PWA

| Écran                                                   | Qui                     | Rôle                                                                                                                                                                                       |
| ------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/`, `/affaires/:id`                                    | Technicien (hors ligne) | « Prêt pour le hors ligne », dernière synchronisation, file d'envoi, espace utilisé ; équipements et PV, création d'un PV sur site                                                         |
| `/pv/:versionId`, `/apercu`, `/signature`               | Technicien (hors ligne) | Saisie section par section, liste des E/S virtualisée (filtres, compteur), NC → observation / réserve, ce qui manque, aperçu paginé, statut BPO / BPE / CMS, signatures ou refus de signer |
| `/preparation`, `/preparation/affaires/:id`, `…/import` | Préparateur, admin      | Fiche affaire (équipements, feuilles, PV, versions de liste), import d'une liste E/S avec rapport d'anomalies et associations                                                              |
| `/preparation/pv/:pvId`                                 | Préparateur, admin      | Même éditeur en mode « préparation », affectation, duplication                                                                                                                             |
| `/suivi`                                                | Préparateur, admin      | Suivi filtrable, valeurs préparées modifiées, dépôts, téléchargement PDF / JSON / XLSX                                                                                                     |
| `/admin/depots`, `/admin/sharepoint`                    | Admin                   | Dépôts en erreur (badge d'alerte) et relance ; chemin relatif par famille                                                                                                                  |

**Essai de bout en bout (19/11/2026, local, SharePoint simulé)** : import du vrai `GAU11_AUT_009`, PV préparé puis affecté,
synchronisation de la tablette, serveur coupé, saisie (relevés, NC transformé en réserve, E/S et SCADA), aperçu paginé et
signatures hors ligne, puis dépôt automatique des PDF / JSON / XLSX au retour du serveur. Deux défauts trouvés et corrigés :
l'indicateur « Prêt pour le hors ligne » ne se mettait pas à jour, et une session ouverte hors ligne ne se rétablissait pas
seule au retour du réseau.

## Lot 2 — contenu

Révisions et réserves (spec §3.4, §4.3).

- **Révision suivante** : `POST /api/pv/{id}/revisions` (technicien, préparateur ou administrateur de l'affaire), à
  partir d'un PV **déposé**. Le serveur réserve l'indice (A → B … Z) : tant que la révision n'est pas déposée, aucune
  autre ne peut être créée. Les données sont reprises ; signatures et statut BPO / BPE / CMS sont vidés ; une ligne est
  ajoutée au tableau des révisions (« Validé par » et « Approuvé par » repris, description saisie à la création).
- **Tablette** : « Créer la révision B » depuis un PV déposé (réseau requis), y compris quand la copie locale du PV a
  été retirée de la tablette (les PV déposés de l'affaire arrivent avec la synchronisation). La révision se remplit et
  se signe ensuite hors ligne, comme un PV préparé.
- **Bureau** : création de la révision depuis le détail du PV, annulation d'une révision non commencée (l'indice est
  libéré, les révisions signées ne sont jamais supprimées), historique des révisions avec leurs fichiers.
- **Levée de réserves** : dans l'éditeur, « Lever la réserve » (date, commentaire, indice de la révision qui lève). Une
  réserve d'une révision précédente ne se supprime pas ; une levée ne s'annule que dans la révision qui l'a prononcée.
- **Intégrité** : à la réception d'une révision, le serveur refuse un tableau des révisions réécrit, une réserve
  disparue ou une levée antérieure modifiée (`controlesRevision`, `packages/shared`).
- **Suivi des réserves** (`/reserves`, `GET /api/prep/reserves`) : état à la dernière révision signée de chaque PV,
  filtres affaire / statut / criticité, réserves en retard, révision en cours.
- Migration `0002_lot2_reserves` : responsable, échéance et levée dans la table `reserve`.

**Critère de fin du lot 2** : « une réserve levée en révision B, les révisions A et B présentes dans SharePoint ».
Vérifié en local le 20/11/2026 (SharePoint simulé) par `apps/api/test/revisions.test.ts` et par un essai dans le
navigateur ; reste à constater sur le SharePoint réel (points ouverts n°1 à 3).

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
- Les fichiers « déposés » en mode simulé sont dans `apps/api/.data/sharepoint/`, leurs copies d'archive dans `apps/api/.data/archive/`.
- Le PDF est rendu par Chromium : Edge ou Chrome sont détectés automatiquement, sinon renseigner `CHROMIUM_EXECUTABLE_PATH`.
- Avec PGlite, l'API traite elle-même la file des dépôts (`WORKER_INLINE`) ; avec PostgreSQL, lancer aussi le worker (`node dist/worker.js`).

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

## Tests de bout en bout (Playwright, tablette)

Dossier `e2e/` : le parcours du technicien est rejoué dans un navigateur, en viewport iPad **portrait (768×1024)** et
**paysage (1024×768)** avec émulation tactile. Le serveur testé est le vrai build (API + PWA), sur une base PGlite en
mémoire et un SharePoint simulé : aucune donnée n'est conservée, toutes les données sont fictives (`e2e/donnees.ts`).

```bash
pnpm --filter @spie/e2e exec playwright install chromium   # une fois
pnpm e2e                                                   # build + tous les scénarios, deux orientations
pnpm --filter @spie/e2e e2e -- --project=ipad-portrait 03  # un fichier, une orientation
pnpm --filter @spie/e2e e2e:rapport                        # rapport HTML (traces des échecs)
```

Sans téléchargement de Chromium : `E2E_NAVIGATEUR=msedge` (ou `chrome`) utilise un navigateur déjà installé.

| Fichier                             | Ce qui est vérifié                                                                      |
| ----------------------------------- | --------------------------------------------------------------------------------------- |
| `tests/01-parcours-nominal`         | PV complet → signature → dépôt SharePoint → retrouvé dans la liste → rouvert identique  |
| `tests/02-modification-suppression` | Modification d'un PV existant, suppression d'une observation et d'un brouillon          |
| `tests/03-validation`               | Champs obligatoires, nombres invalides, NC sans observation, accents, textes très longs |
| `tests/04-envoi-au-serveur`         | Échec réseau, erreur 500, refus 409, serveur muet (timeout), double appui sans doublon  |
| `tests/05-hors-ligne-rechargement`  | Réseau coupé en pleine saisie, signature hors ligne, rechargement de la page            |
| `tests/06-ergonomie-tablette`       | Pas de défilement horizontal, cibles ≥ 44 px, libellés, contrastes (axe), claviers      |
| `tests/07-securite`                 | HTML saisi jamais exécuté, API fermée sans session, jeton illisible par un script       |

`e2e/outils.ts` regroupe les gestes du technicien (se connecter, créer un PV, tout remplir, signer) : un scénario se
lit comme un mode opératoire. Les captures d'écran des écrans principaux sont écrites dans `e2e/captures/<orientation>/`.
Non couvert : le clavier virtuel (à contrôler sur une vraie tablette).

## Configuration de l'API

Variables principales (toutes dans `apps/api/src/config.ts`) :

| Variable                                                                                                 | Défaut hors production   | Production                                                                 |
| -------------------------------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                                           | `pglite://.data/pglite`  | Obligatoire (`postgres://…?sslmode=require`)                               |
| `JWT_SECRET`                                                                                             | clé de développement     | Obligatoire, ≥ 32 caractères (Key Vault)                                   |
| `SHAREPOINT_MODE`                                                                                        | `fake`                   | `graph`                                                                    |
| `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CERT_PEM` (ou `GRAPH_CERT_PATH`), `SHAREPOINT_SITE_ID`      | —                        | Obligatoires en mode `graph`                                               |
| `COOKIE_SECURE`                                                                                          | `false`                  | `true`                                                                     |
| `TRUST_PROXY` (adresses des proxys de confiance, syntaxe proxy-addr)                                     | aucun                    | `loopback, linklocal, uniquelocal, 100.64.0.0/10` (ingress Container Apps) |
| `WEB_DIST_DIR`                                                                                           | —                        | `/app/public` (l'API sert la PWA, même origine)                            |
| `ARCHIVE_MODE`, `ARCHIVE_DIR`, `AZURE_STORAGE_ACCOUNT_URL`, `AZURE_STORAGE_CONTAINER`, `AZURE_CLIENT_ID` | `local`, `.data/archive` | `azure` (identité managée, variables posées par l'infra)                   |
| `CHROMIUM_EXECUTABLE_PATH`                                                                               | détection Edge / Chrome  | `/usr/bin/chromium` (image Docker)                                         |
| `WORKER_INLINE`, `WORKER_POLL_SECONDS`                                                                   | `true` avec PGlite, 15 s | `false` (worker séparé), 15 s                                              |
| `SHAREPOINT_CREATE_MISSING_FOLDERS`                                                                      | `true`                   | `true` (point ouvert n°13)                                                 |
| `NC_OBSERVATION_OBLIGATOIRE`                                                                             | `true`                   | `true` (point ouvert n°9)                                                  |
| `BOOTSTRAP_ADMIN_EMAIL` / `_NAME` / `_PASSWORD`                                                          | —                        | Facultatif                                                                 |

## Choix d'implémentation à valider

- **Microsoft Graph** est appelé par un petit client `fetch` + `@azure/identity` (certificat) plutôt que par le SDK Graph : mêmes routes, moins de dépendances, et testable sans tenant (`apps/api/test/graph.test.ts`).
- **Verrouillage** : 15 minutes après 5 échecs (durée non précisée par la spec, paramétrable : `LOGIN_LOCK_MINUTES`).
- **Rotation des jetons** : un jeton de rafraîchissement remplacé reste accepté 10 s (deux onglets qui rafraîchissent ensemble) ; au-delà, sa réutilisation révoque toutes les sessions issues de la même connexion.
- **Node 22.12 minimum** : `@fastify/cookie` dépend de `cookie@2`, publié uniquement en module ES. La production tourne en Node 24.
- **File des dépôts** : la table `depot` sert de file (réservation `FOR UPDATE SKIP LOCKED` + bail de 5 min) au lieu de pg-boss. L'état de chaque dépôt (tentatives, prochaine reprise, erreur) doit de toute façon être en base pour le back-office et la relance ; une seconde file aurait dédoublé cet état.
- **Point ouvert n°10** : la feuille `HTB_TR1` contient 27 E/S « PROTECTION TRANSFO BOBINE POINT NEUTRE » (cartes PS050 et IO060), très probablement celles de `RPN_HTB_MCN_TR`. Une feuille peut donc être associée à un équipement avec un **filtre sur la colonne TAG** ; à confirmer par SPIE.
- **Points ouverts n°9, 11, 12, 13** : observation obligatoire sur NC (paramétrable), nommage `PV_MES_<tag>_<numéro>_ind<indice>` proposé au §5.3, JSON et XLSX déposés à côté du PDF, sous-dossiers manquants créés (paramétrable).
- **Point ouvert n°8** : l'annexe « valeurs pré-remplies modifiées sur site » existe dans le modèle mais n'est pas imprimée par défaut ; les modifications sont visibles dans le suivi du back-office.
- **Duplication** : la copie reprend tout le PV préparé et ses techniciens, avec la liste E/S de l'équipement cible ; le numéro de série et l'adresse IP sont vidés.
- **Doublons d'adresse** : signalés par groupe TAG d'une feuille. Dans `HTB_TR1`, `I1` et `I2` apparaissent sur deux cartes différentes (IO203 et IO202) : simple avertissement.
- **Fond de page** : la sphère SPIE éclaircie en fond de page reprend l'image du modèle Word ; à valider par SPIE avec le reste du PDF.
- **Icônes PWA** provisoires (`apps/web/scripts/generate-icons.mjs`), à remplacer par le logo SPIE validé.
