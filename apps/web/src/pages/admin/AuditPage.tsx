import { AUDIT_ACTIONS, valeurLisible, type AuditEntryDto } from "@spie/shared";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Alert, Button, Loading, PageHeader, Table, Td } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { formatDateTime } from "../../lib/format";

const PAGE = 50;

/** Libellés des clés de détails écrites par l'API (journal lisible, sans JSON brut). */
const CLES: Record<string, string> = {
  numero: "N°",
  email: "E-mail",
  nom: "Nom",
  role: "Rôle",
  actif: "Actif",
  affaire: "Affaire",
  equipement: "Équipement",
  tag: "Équipement",
  indice: "Indice",
  empreinte: "Empreinte",
  ajoutes: "Ajoutés",
  retires: "Retirés",
  chemins: "Valeurs modifiées",
  fichier: "Fichier",
  dossier: "Dossier",
  webUrl: "Lien",
  feuille: "Feuille E/S",
  filtreTag: "Filtre TAG",
  version: "Version",
  reference: "Référence",
  revision: "Révision",
  points: "E/S",
  equipementsCrees: "Équipements créés",
  equipementsMisAJour: "Équipements mis à jour",
  famille: "Famille",
  familles: "Familles",
  cheminRelatif: "Chemin relatif",
  vers: "Vers",
  erreur: "Erreur",
  derniereErreur: "Dernière erreur",
  tentatives: "Tentatives",
  echecs: "Échecs",
  raison: "Raison",
  mode: "Mode",
  ip: "IP",
  modifications: "Modifications",
  // Entrées « Affaire modifiée » antérieures : liste des champs envoyés par le formulaire.
  champs: "Champs envoyés",
};

/** Champs d'une affaire (détail « Affaire modifiée »). */
const CHAMPS_AFFAIRE: Record<string, string> = {
  numero: "N° d'affaire",
  client: "Client",
  projet: "Projet",
  site: "Site",
  valideParDefaut: "« Validé par » par défaut",
  approuveParDefaut: "« Approuvé par » par défaut",
  dossierSharePoint: "Dossier SharePoint",
  archivee: "Archivée",
};

function texte(v: unknown): string {
  if (v === null || v === undefined || v === "") return "(vide)";
  if (typeof v === "boolean") return v ? "oui" : "non";
  if (Array.isArray(v)) return v.length === 0 ? "—" : v.map(texte).join(", ");
  return valeurLisible(v).replace(/\n/g, " ; ");
}

/** Détails d'une entrée du journal en lignes « libellé : valeur » ; « avant → après » pour les modifications. */
export function detailsLisibles(details: Record<string, unknown> | null): { libelle: string; valeur: string }[] {
  if (!details) return [];
  return Object.entries(details).flatMap(([k, v]) => {
    const estModif = (x: unknown): x is { avant: unknown; apres: unknown } =>
      typeof x === "object" && x !== null && "avant" in x && "apres" in x;
    if (k === "modifications" && typeof v === "object" && v !== null && !Array.isArray(v)) {
      return Object.entries(v).map(([champ, m]) => ({
        libelle: CHAMPS_AFFAIRE[champ] ?? CLES[champ] ?? champ,
        valeur: estModif(m) ? `${texte(m.avant)} → ${texte(m.apres)}` : texte(m),
      }));
    }
    return [{ libelle: CLES[k] ?? k, valeur: texte(v) }];
  });
}

function Details({ details }: { details: Record<string, unknown> | null }) {
  const lignes = detailsLisibles(details);
  if (lignes.length === 0) return null;
  return (
    <dl className="text-sm text-slate-700">
      {lignes.map((l, i) => (
        <div key={i} className="flex gap-1">
          <dt className="whitespace-nowrap font-medium">{l.libelle} :</dt>
          <dd className="break-all">{l.valeur}</dd>
        </div>
      ))}
    </dl>
  );
}

export function AuditPage() {
  const journal = useInfiniteQuery({
    queryKey: ["admin", "audit"],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api<AuditEntryDto[]>(`/api/admin/audit?limit=${PAGE}${pageParam ? `&before=${pageParam}` : ""}`),
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1]!.id : null),
  });

  return (
    <>
      <PageHeader
        title="Journal d'audit"
        subtitle="Connexions et actions d'administration, du plus récent au plus ancien."
      />
      {journal.isPending ? (
        <Loading />
      ) : journal.isError ? (
        <Alert kind="error">{errorMessage(journal.error)}</Alert>
      ) : (
        <div className="space-y-4">
          <Table head={["Date", "Action", "Par", "Détails", "IP"]}>
            {journal.data.pages.flat().map((e) => (
              <tr key={e.id}>
                <Td className="whitespace-nowrap text-sm">{formatDateTime(e.at)}</Td>
                <Td className="font-medium">{AUDIT_ACTIONS[e.action] ?? e.action}</Td>
                <Td className="text-sm">{e.actor ? e.actor.nom : "—"}</Td>
                <Td>
                  <Details details={e.details} />
                </Td>
                <Td className="text-sm text-slate-600">{e.ip ?? "—"}</Td>
              </tr>
            ))}
          </Table>
          {journal.hasNextPage && (
            <Button variant="secondary" busy={journal.isFetchingNextPage} onClick={() => void journal.fetchNextPage()}>
              Afficher les entrées plus anciennes
            </Button>
          )}
        </div>
      )}
    </>
  );
}
