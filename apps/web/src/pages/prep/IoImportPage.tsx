import type {
  AnomalieImport,
  AssociationEquipementInput,
  IoImportAnalyseDto,
  IoImportResultDto,
  SeveriteAnomalie,
} from "@spie/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { Alert, Badge, Button, Card, PageHeader, Select, Table, Td } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { fileToBase64 } from "../../lib/files";

/** Import d'une liste E/S (spec §4.4) : analyse, rapport d'anomalies, association équipement ↔ feuille, import. */

export type ChoixAssociations = Record<string, { feuille: string | null; filtreTag: string | null }>;

export function choixInitiaux(a: IoImportAnalyseDto): ChoixAssociations {
  return Object.fromEntries(
    a.equipements.map((e) => [e.tag, { feuille: e.association.feuille, filtreTag: e.association.filtreTag }]),
  );
}

/** Associations envoyées à l'import : une par équipement, filtre ignoré si la feuille n'a qu'un groupe TAG. */
export function associationsAEnvoyer(a: IoImportAnalyseDto, choix: ChoixAssociations): AssociationEquipementInput[] {
  return a.equipements.map((e) => {
    const c = choix[e.tag] ?? { feuille: null, filtreTag: null };
    const feuille = a.feuilles.find((f) => f.nom === c.feuille);
    const filtreValide = feuille && c.filtreTag && feuille.groupesTag.includes(c.filtreTag) ? c.filtreTag : null;
    return { tag: e.tag, feuille: feuille ? feuille.nom : null, filtreTag: filtreValide };
  });
}

/** Anomalies produites par l'association équipement ↔ feuille (les autres viennent de la lecture du fichier). */
const CODES_ASSOCIATION = new Set<AnomalieImport["code"]>([
  "equipement_sans_feuille",
  "feuille_inconnue",
  "filtre_tag_inconnu",
  "feuille_precedente_absente",
]);

/**
 * Rapport d'anomalies tenant compte des choix faits à l'écran, sans nouvel aller-retour au serveur : pour un
 * équipement dont l'association a changé, ses anomalies d'association sont recalculées (feuille et filtre sont
 * choisis dans des listes : seul « aucune feuille » reste possible) ; pour les autres, celles du serveur restent.
 */
export function rapportAJour(a: IoImportAnalyseDto, choix: ChoixAssociations): AnomalieImport[] {
  const change = (e: IoImportAnalyseDto["equipements"][number]) => {
    const c = choix[e.tag];
    return c !== undefined && (c.feuille !== e.association.feuille || c.filtreTag !== e.association.filtreTag);
  };
  const changes = a.equipements.filter(change);
  const lignesChangees = new Set(changes.map((e) => e.ligne));
  // Les codes d'association ne concernent que la feuille des équipements : la ligne désigne l'équipement.
  const gardees = a.anomalies.filter((x) => !(CODES_ASSOCIATION.has(x.code) && lignesChangees.has(x.ligne ?? -1)));
  const nouvelles: AnomalieImport[] = changes
    .filter((e) => !choix[e.tag]?.feuille)
    .map((e) => ({
      code: "equipement_sans_feuille",
      severite: "avertissement",
      feuille: "LISTE DES EQUIPEMENTS",
      ligne: e.ligne,
      message: `${e.tag} : aucune feuille d'E/S choisie.`,
    }));
  return [...gardees, ...nouvelles];
}

const SEVERITES: { s: SeveriteAnomalie; titre: string; kind: "error" | "warning" | "info" }[] = [
  { s: "erreur", titre: "Erreurs (import impossible)", kind: "error" },
  { s: "avertissement", titre: "Avertissements", kind: "warning" },
  { s: "info", titre: "Informations", kind: "info" },
];

export function RapportAnomalies({ anomalies }: { anomalies: readonly AnomalieImport[] }) {
  if (anomalies.length === 0) return <Alert kind="success">Aucune anomalie.</Alert>;
  return (
    <div className="space-y-3">
      {SEVERITES.map(({ s, titre, kind }) => {
        const liste = anomalies.filter((a) => a.severite === s);
        if (liste.length === 0) return null;
        return (
          <Alert key={s} kind={kind}>
            <p className="font-semibold">
              {titre} ({liste.length})
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {liste.map((a, i) => (
                <li key={i}>
                  {a.feuille && <strong>{a.feuille}</strong>}
                  {a.ligne !== null && ` ligne ${a.ligne}`}
                  {(a.feuille || a.ligne !== null) && " : "}
                  {a.message}
                </li>
              ))}
            </ul>
          </Alert>
        );
      })}
    </div>
  );
}

export function IoImportPage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const [fichier, setFichier] = useState<{ nom: string; base64: string } | null>(null);
  const [choix, setChoix] = useState<ChoixAssociations>({});
  const [resultat, setResultat] = useState<IoImportResultDto | null>(null);

  const analyse = useMutation({
    mutationFn: async (f: { nom: string; base64: string }) =>
      api<IoImportAnalyseDto>(`/api/prep/affaires/${id}/io-lists/analyse`, {
        method: "POST",
        body: { fichier: f.nom, contenuBase64: f.base64 },
      }),
    onSuccess: (a) => setChoix(choixInitiaux(a)),
  });
  const importer = useMutation({
    mutationFn: () =>
      api<IoImportResultDto>(`/api/prep/affaires/${id}/io-lists`, {
        method: "POST",
        body: {
          fichier: fichier!.nom,
          contenuBase64: fichier!.base64,
          associations: associationsAEnvoyer(analyse.data!, choix),
        },
      }),
    onSuccess: (r) => {
      setResultat(r);
      void qc.invalidateQueries({ queryKey: ["prep"] });
    },
  });

  const a = analyse.data;
  const rapport = a ? rapportAJour(a, choix) : null;
  const bloquant = rapport?.some((x) => x.severite === "erreur") ?? false;
  return (
    <>
      <PageHeader
        title="Importer une liste E/S"
        subtitle={
          <Link to={`/preparation/affaires/${id}`} className="underline">
            Retour à l'affaire
          </Link>
        }
      />
      <div className="space-y-6">
        <Card>
          <p className="mb-3 font-semibold">Fichier Excel de la liste des entrées / sorties (.xlsx)</p>
          <div className="flex flex-wrap items-center gap-3">
            {/* Le champ natif est masqué : une grande cible, utilisable au doigt et au clavier (focus visible). */}
            <label className="inline-flex min-h-12 cursor-pointer items-center rounded-lg border-2 border-brand-700 bg-white px-5 font-semibold text-brand-800 focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-brand-500 hover:bg-brand-50">
              <input
                type="file"
                aria-label="Fichier Excel de la liste des entrées / sorties"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="sr-only"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  setResultat(null);
                  analyse.reset();
                  importer.reset();
                  if (!f) return setFichier(null);
                  const lu = { nom: f.name, base64: await fileToBase64(f) };
                  setFichier(lu);
                  analyse.mutate(lu);
                }}
              />
              {fichier ? "Choisir un autre fichier…" : "Choisir le fichier…"}
            </label>
            <span className="break-all text-slate-700">{fichier ? fichier.nom : "Aucun fichier choisi."}</span>
          </div>
          {analyse.isPending && <p className="mt-3">Analyse du fichier…</p>}
          {analyse.isError && (
            <div className="mt-3">
              <Alert kind="error">{errorMessage(analyse.error)}</Alert>
            </div>
          )}
        </Card>

        {a && (
          <>
            <Card>
              <h2 className="mb-2 text-lg font-bold">Fichier</h2>
              <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-[max-content_1fr]">
                <dt className="text-slate-600">Fichier</dt>
                <dd className="break-all">{a.fichier}</dd>
                <dt className="text-slate-600">Référence</dt>
                <dd>{a.reference || "—"}</dd>
                <dt className="text-slate-600">Révision</dt>
                <dd>{a.revision || "—"}</dd>
                <dt className="text-slate-600">N° d'affaire</dt>
                <dd>{a.numeroAffaire || "—"}</dd>
              </dl>
            </Card>
            <section>
              <h2 className="mb-3 text-xl font-bold">Rapport d'anomalies</h2>
              <RapportAnomalies anomalies={resultat ? resultat.analyse.anomalies : (rapport ?? [])} />
            </section>
            <section>
              <h2 className="mb-3 text-xl font-bold">Feuilles d'E/S</h2>
              <Table head={["Feuille", "E/S", "Réserves", "Groupes (colonne TAG)"]}>
                {a.feuilles.map((f) => (
                  <tr key={f.nom}>
                    <Td className="font-semibold">{f.nom}</Td>
                    <Td>{f.nbPoints}</Td>
                    <Td>{f.nbReserves}</Td>
                    <Td className="text-sm">{f.groupesTag.join(" · ") || "—"}</Td>
                  </tr>
                ))}
              </Table>
            </section>
            <section>
              <h2 className="mb-1 text-xl font-bold">Association équipement ↔ feuille</h2>
              <p className="mb-3 text-slate-600">
                Automatique via la colonne TYPE CELLULE ; à choisir quand elle ne suffit pas (relais HTB, régulateur).
                Une feuille qui décrit plusieurs équipements peut être restreinte à un groupe de la colonne TAG. Les
                choix faits pour la version précédente de la liste sont repris.
              </p>
              <Table head={["Équipement", "Type cellule", "Feuille", "Partie de la feuille", ""]}>
                {a.equipements.map((e) => {
                  const c = choix[e.tag] ?? { feuille: null, filtreTag: null };
                  const feuille = a.feuilles.find((f) => f.nom === c.feuille);
                  return (
                    <tr key={e.tag} className="align-top">
                      <Td>
                        <div className="font-bold">{e.tag}</div>
                        <div className="text-sm text-slate-600">{e.libelle}</div>
                      </Td>
                      <Td>{e.typeCellule || <Badge tone="amber">vide</Badge>}</Td>
                      <Td>
                        <Select
                          aria-label={`Feuille de ${e.tag}`}
                          value={c.feuille ?? ""}
                          onChange={(ev) =>
                            setChoix({ ...choix, [e.tag]: { feuille: ev.target.value || null, filtreTag: null } })
                          }
                        >
                          <option value="">Aucune feuille</option>
                          {a.feuilles.map((f) => (
                            <option key={f.nom} value={f.nom}>
                              {f.nom}
                            </option>
                          ))}
                        </Select>
                      </Td>
                      <Td>
                        {feuille && feuille.groupesTag.length > 1 ? (
                          <Select
                            aria-label={`Partie de la feuille pour ${e.tag}`}
                            value={c.filtreTag ?? ""}
                            onChange={(ev) =>
                              setChoix({ ...choix, [e.tag]: { ...c, filtreTag: ev.target.value || null } })
                            }
                          >
                            <option value="">Toute la feuille</option>
                            {feuille.groupesTag.map((g) => (
                              <option key={g} value={g}>
                                {g}
                              </option>
                            ))}
                          </Select>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </Td>
                      <Td>
                        {c.feuille === e.association.feuille && e.association.mode === "auto" ? (
                          <Badge tone="green">Automatique</Badge>
                        ) : c.feuille === e.association.feuille &&
                          c.filtreTag === e.association.filtreTag &&
                          e.association.mode === "reprise" ? (
                          <Badge tone="green">Reprise de la version précédente</Badge>
                        ) : c.feuille ? (
                          <Badge tone="blue">Choisie</Badge>
                        ) : (
                          <Badge tone="amber">Sans feuille</Badge>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </Table>
            </section>
            {importer.isError && <Alert kind="error">{errorMessage(importer.error)}</Alert>}
            {resultat ? (
              <Alert kind="success">
                <p className="font-semibold">
                  Liste importée : version {resultat.liste.version} ({resultat.liste.nbFeuilles} feuilles,{" "}
                  {resultat.liste.nbPoints} E/S).
                </p>
                <p>
                  {resultat.equipementsCrees} équipement(s) créé(s), {resultat.equipementsMisAJour} mis à jour.
                </p>
                <Link to={`/preparation/affaires/${id}`} className="mt-2 inline-block font-semibold underline">
                  Retour à l'affaire
                </Link>
              </Alert>
            ) : (
              <Button busy={importer.isPending} disabled={bloquant || !fichier} onClick={() => importer.mutate()}>
                {bloquant ? "Import impossible (erreurs bloquantes)" : "Importer cette liste"}
              </Button>
            )}
          </>
        )}
      </div>
    </>
  );
}
