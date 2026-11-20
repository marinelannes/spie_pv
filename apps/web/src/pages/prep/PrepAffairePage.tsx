import {
  modelePvEquipement,
  statutSuivi,
  type EquipementDto,
  type ListeEsDetailDto,
  type PrepAffaireDto,
  type PvDetailDto,
  type PvResumeDto,
  type SetAssociationRequest,
} from "@spie/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { BadgeStatutPv, BadgesDepots } from "../../components/statuts";
import { Alert, Badge, Button, Loading, PageHeader, Select, Table, Td } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { formatDateTime } from "../../lib/format";

/** Fiche d'une affaire en préparation : équipements, versions de la liste E/S, PV (spec §4.6). */
export function PrepAffairePage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const detail = useQuery({
    queryKey: ["prep", "affaire", id],
    queryFn: () => api<PrepAffaireDto>(`/api/prep/affaires/${id}`),
  });
  const derniere = detail.data?.listes.slice().sort((a, b) => b.version - a.version)[0];
  const liste = useQuery({
    queryKey: ["prep", "io-list", derniere?.id],
    queryFn: () => api<ListeEsDetailDto>(`/api/prep/io-lists/${derniere!.id}`),
    enabled: Boolean(derniere),
  });
  const [erreur, setErreur] = useState<string | null>(null);
  const invalider = () => qc.invalidateQueries({ queryKey: ["prep"] });

  const creerPv = useMutation({
    mutationFn: (equipementId: string) =>
      api<PvDetailDto>("/api/prep/pv", { method: "POST", body: { affaireId: id, equipementId } }),
    onSuccess: (pv) => {
      void invalider();
      navigate(`/preparation/pv/${pv.pvId}`);
    },
    onError: (e) => setErreur(errorMessage(e)),
  });
  const supprimer = useMutation({
    mutationFn: (pvId: string) => api<void>(`/api/prep/pv/${pvId}`, { method: "DELETE" }),
    onSuccess: () => void invalider(),
    onError: (e) => setErreur(errorMessage(e)),
  });

  if (detail.isPending) return <Loading />;
  if (detail.isError) return <Alert kind="error">{errorMessage(detail.error)}</Alert>;
  const { affaire, equipements, listes, pvs, techniciens } = detail.data;

  return (
    <>
      <PageHeader
        title={`${affaire.numero} — ${affaire.projet}`}
        subtitle={`${affaire.client}${affaire.site ? ` — ${affaire.site}` : ""} · ${techniciens.length} technicien(s) affecté(s)`}
        actions={
          <Link
            to={`/preparation/affaires/${id}/import`}
            className="inline-flex min-h-12 items-center rounded-lg bg-brand-700 px-5 font-semibold text-white hover:bg-brand-800"
          >
            Importer une liste E/S
          </Link>
        }
      />
      {erreur && (
        <div className="mb-4">
          <Alert kind="error">{erreur}</Alert>
        </div>
      )}
      <div className="space-y-6">
        <section>
          <h2 className="mb-3 text-xl font-bold">Équipements</h2>
          {equipements.length === 0 ? (
            <Alert kind="info">
              Aucun équipement : importez la liste E/S de l'affaire (feuille LISTE DES EQUIPEMENTS).
            </Alert>
          ) : (
            <Table head={["Équipement", "Type cellule", "Feuille E/S", "E/S", "PV", ""]}>
              {equipements.map((e) => (
                <LigneEquipement
                  key={e.id}
                  e={e}
                  liste={liste.data ?? null}
                  creation={creerPv.isPending && creerPv.variables === e.id}
                  onCreer={() => creerPv.mutate(e.id)}
                  onModifie={() => void invalider()}
                />
              ))}
            </Table>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-xl font-bold">PV de l'affaire</h2>
          {pvs.length === 0 ? (
            <Alert kind="info">Aucun PV.</Alert>
          ) : (
            <TablePv
              pvs={pvs}
              onSupprimer={(p) => {
                if (window.confirm(`Supprimer le PV préparé ${p.numero} ?`)) supprimer.mutate(p.pvId);
              }}
            />
          )}
        </section>

        <section>
          <h2 className="mb-3 text-xl font-bold">Versions de la liste E/S</h2>
          {listes.length === 0 ? (
            <Alert kind="info">Aucune liste importée.</Alert>
          ) : (
            <Table head={["Version", "Référence", "Révision", "Fichier", "Importée", "Feuilles / E/S", "Anomalies"]}>
              {listes
                .slice()
                .sort((a, b) => b.version - a.version)
                .map((l) => (
                  <tr key={l.id}>
                    <Td>
                      <Link
                        to={`/preparation/io-lists/${l.id}`}
                        className="font-bold text-brand-700 underline"
                        aria-label={`Consulter la version ${l.version} de la liste E/S`}
                      >
                        v{l.version}
                      </Link>
                    </Td>
                    <Td>{l.referenceDocument}</Td>
                    <Td>{l.revision}</Td>
                    <Td className="break-all text-sm">{l.fichierSource}</Td>
                    <Td className="text-sm">
                      {formatDateTime(l.importeLe)}
                      {l.importePar && <div>{l.importePar}</div>}
                    </Td>
                    <Td>
                      {l.nbFeuilles} / {l.nbPoints}
                    </Td>
                    <Td>
                      <Link to={`/preparation/io-lists/${l.id}`} className="underline">
                        {l.anomalies.length > 0 ? `${l.anomalies.length} — voir le rapport` : "Aucune — voir la liste"}
                      </Link>
                    </Td>
                  </tr>
                ))}
            </Table>
          )}
        </section>
      </div>
    </>
  );
}

function LigneEquipement({
  e,
  liste,
  creation,
  onCreer,
  onModifie,
}: {
  e: EquipementDto;
  liste: ListeEsDetailDto | null;
  creation: boolean;
  onCreer: () => void;
  onModifie: () => void;
}) {
  const [edition, setEdition] = useState(false);
  const [feuilleId, setFeuilleId] = useState(e.feuilleEsId ?? "");
  const [filtre, setFiltre] = useState(e.filtreTag ?? "");
  const feuille = liste?.feuilles.find((f) => f.id === feuilleId);
  const enregistrer = useMutation({
    mutationFn: (body: SetAssociationRequest) =>
      api<EquipementDto>(`/api/prep/equipements/${e.id}/association`, { method: "PUT", body }),
    onSuccess: () => {
      setEdition(false);
      onModifie();
    },
  });
  return (
    <tr className="align-top">
      <Td>
        <div className="font-bold">{e.tag}</div>
        <div className="text-sm text-slate-600">{e.libelle}</div>
        <div className="text-sm text-slate-500">
          {[e.niveauTension, e.equipement, e.modele].filter(Boolean).join(" — ")}
        </div>
      </Td>
      <Td>{e.typeCellule || <Badge tone="amber">vide</Badge>}</Td>
      <Td>
        {edition ? (
          <div className="min-w-64 space-y-2">
            <Select
              aria-label={`Feuille E/S de ${e.tag}`}
              value={feuilleId}
              onChange={(ev) => {
                setFeuilleId(ev.target.value);
                setFiltre("");
              }}
            >
              <option value="">Aucune feuille</option>
              {liste?.feuilles.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nom} ({f.points.length} E/S)
                </option>
              ))}
            </Select>
            {feuille && feuille.groupesTag.length > 1 && (
              <Select
                aria-label={`Partie de la feuille pour ${e.tag}`}
                value={filtre}
                onChange={(ev) => setFiltre(ev.target.value)}
              >
                <option value="">Toute la feuille</option>
                {feuille.groupesTag.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </Select>
            )}
            {enregistrer.isError && <Alert kind="error">{errorMessage(enregistrer.error)}</Alert>}
            <div className="flex gap-2">
              <Button
                busy={enregistrer.isPending}
                onClick={() => enregistrer.mutate({ feuilleEsId: feuilleId || null, filtreTag: filtre || null })}
              >
                Enregistrer
              </Button>
              <Button variant="ghost" onClick={() => setEdition(false)}>
                Annuler
              </Button>
            </div>
          </div>
        ) : (
          <>
            {e.feuilleNom ? (
              <span>
                {e.feuilleNom}
                {e.filtreTag && <div className="text-sm text-slate-600">{e.filtreTag}</div>}
              </span>
            ) : (
              <Badge tone="amber">Aucune feuille</Badge>
            )}
            {liste && (
              <div>
                <button type="button" className="min-h-12 text-brand-800 underline" onClick={() => setEdition(true)}>
                  Changer
                </button>
              </div>
            )}
          </>
        )}
      </Td>
      <Td>{e.nbPointsEs}</Td>
      <Td className="text-sm">
        {e.avancement.nbPv} PV
        {e.avancement.enCours > 0 && <div>{e.avancement.enCours} en cours</div>}
        {e.avancement.deposes > 0 && <div className="text-green-800">{e.avancement.deposes} déposé(s)</div>}
      </Td>
      <Td>
        {modelePvEquipement(e) ? (
          <Button variant="secondary" busy={creation} onClick={onCreer}>
            Créer un PV
          </Button>
        ) : (
          <span className="text-sm text-slate-600">Pas de modèle de PV</span>
        )}
      </Td>
    </tr>
  );
}

export function TablePv({ pvs, onSupprimer }: { pvs: readonly PvResumeDto[]; onSupprimer?: (p: PvResumeDto) => void }) {
  return (
    <Table head={["N° PV", "Équipement", "Statut", "Techniciens", "Avancement E/S", "Suivi", ""]}>
      {pvs.map((p) => (
        <tr key={p.versionId} className="align-top hover:bg-slate-50">
          <Td>
            <Link
              to={`/preparation/pv/${p.pvId}`}
              className="font-mono font-bold text-brand-700 underline-offset-4 hover:underline"
            >
              {p.numero}
            </Link>
            <div className="text-sm text-slate-600">
              ind. {p.indice} · {p.affaireNumero}
            </div>
          </Td>
          <Td>
            {p.equipementTag ?? "—"}
            {p.equipementLibelle && <div className="text-sm text-slate-600">{p.equipementLibelle}</div>}
          </Td>
          <Td>
            <BadgeStatutPv statut={statutSuivi(p)} />
            {p.statutDocument && <div className="mt-1 text-sm font-semibold">{p.statutDocument}</div>}
          </Td>
          <Td className="text-sm">
            {p.techniciens.length > 0 ? (
              p.techniciens.map((t) => t.nom).join(", ")
            ) : (
              <Badge tone="amber">Non affecté</Badge>
            )}
          </Td>
          <Td className="text-sm">
            {p.avancementEs.testees} / {p.avancementEs.total}
            {p.avancementEs.nc > 0 && <span className="ml-2 font-bold text-red-800">{p.avancementEs.nc} NC</span>}
          </Td>
          <Td className="text-sm">
            {p.saisieCommenceeLe && <div>Saisie commencée {formatDateTime(p.saisieCommenceeLe)}</div>}
            {p.nbModifications > 0 && <Badge tone="amber">{p.nbModifications} valeur(s) préparée(s) modifiée(s)</Badge>}
            {p.alerteDoublon && <Badge tone="red">Numéro en double</Badge>}
            {p.depots.some((d) => d.statut === "erreur") && <Badge tone="red">Dépôt en erreur</Badge>}
            {p.statut === "depose" && <BadgesDepots depots={p.depots} />}
          </Td>
          <Td>
            {onSupprimer && p.statut === "prepare" && !p.saisieCommenceeLe && (
              <Button variant="ghost" onClick={() => onSupprimer(p)}>
                Supprimer
              </Button>
            )}
          </Td>
        </tr>
      ))}
    </Table>
  );
}
