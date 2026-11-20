import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { BadgePvLocal } from "../../components/statuts";
import { Alert, Button, Card, Loading, PageHeader } from "../../components/ui";
import { useUser } from "../../lib/auth";
import { formatDateTime } from "../../lib/format";
import { useLive } from "../../offline/live";
import { creationSurSite, creerPvSurSite } from "../../offline/pv-local";
import { useDb } from "../../offline/SyncProvider";

/** Équipements d'une affaire et leurs PV ; création sur site d'un PV pour un équipement non préparé (spec §3.2). */
export function AffairePage() {
  const { affaireId = "" } = useParams();
  const db = useDb();
  const user = useUser();
  const navigate = useNavigate();
  const affaire = useLive(() => db.affaires.get(affaireId).then((a) => a ?? null), [db, affaireId]);
  const pvs = useLive(() => db.pvs.where("affaireId").equals(affaireId).toArray(), [db, affaireId]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [creation, setCreation] = useState<string | null>(null);

  if (affaire === undefined || pvs === undefined) return <Loading />;
  if (affaire === null)
    return <Alert kind="warning">Affaire absente de cette tablette : synchronisez avec le réseau.</Alert>;

  const creer = async (equipementId: string) => {
    setErreur(null);
    setCreation(equipementId);
    try {
      const pv = await creerPvSurSite(db, { affaire, equipementId, auteur: user.nom });
      navigate(`/pv/${pv.versionId}`);
    } catch (err) {
      setErreur(err instanceof Error ? err.message : String(err));
    } finally {
      setCreation(null);
    }
  };

  const a = affaire.affaire;
  const sansEquipement = pvs.filter((p) => !affaire.equipements.some((e) => e.id === p.equipementId));
  return (
    <>
      <PageHeader title={`${a.numero} — ${a.projet}`} subtitle={`${a.client}${a.site ? ` — ${a.site}` : ""}`} />
      {erreur && (
        <div className="mb-4">
          <Alert kind="error">{erreur}</Alert>
        </div>
      )}
      {affaire.liste ? (
        <p className="mb-4 text-slate-700">
          Liste E/S : {affaire.liste.referenceDocument} rév. {affaire.liste.revision} (version {affaire.liste.version})
        </p>
      ) : (
        <div className="mb-4">
          <Alert kind="info">Aucune liste E/S importée pour cette affaire.</Alert>
        </div>
      )}
      <ul className="space-y-3">
        {affaire.equipements.map((e) => {
          const siens = pvs.filter((p) => p.equipementId === e.id).sort((x, y) => y.creeLe.localeCompare(x.creeLe));
          const surSite = creationSurSite(e, pvs);
          return (
            <li key={e.id}>
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-bold">{e.tag}</p>
                    <p className="text-slate-700">{e.libelle}</p>
                    <p className="text-sm text-slate-600">
                      {[e.equipement, e.modele, e.local].filter(Boolean).join(" — ")}
                      {e.feuilleNom
                        ? ` — feuille E/S ${e.feuilleNom}${e.filtreTag ? ` (${e.filtreTag})` : ""}`
                        : " — pas de feuille E/S"}
                    </p>
                  </div>
                  {surSite.possible ? (
                    <Button variant="secondary" busy={creation === e.id} onClick={() => void creer(e.id)}>
                      Créer un PV sur site
                    </Button>
                  ) : (
                    // Un PV listé ci-dessous suffit à comprendre : la raison n'est affichée que dans les autres cas.
                    siens.length === 0 && <p className="max-w-sm text-sm text-slate-600">{surSite.raison}</p>
                  )}
                </div>
                {siens.length > 0 && (
                  <ul className="mt-3 divide-y divide-slate-200 border-t border-slate-200">
                    {siens.map((p) => (
                      <li key={p.versionId}>
                        <Link
                          to={`/pv/${p.versionId}`}
                          className="flex min-h-12 flex-wrap items-center gap-3 py-2 hover:bg-slate-50"
                        >
                          <span className="font-mono font-semibold">{p.numero}</span>
                          <span>ind. {p.indice}</span>
                          <BadgePvLocal pv={p} />
                          {p.origine === "prepare" && <span className="text-sm text-slate-600">préparé au bureau</span>}
                          {p.erreurEnvoi && <span className="text-sm font-semibold text-red-800">{p.erreurEnvoi}</span>}
                          <span className="ml-auto text-sm text-slate-500">modifié {formatDateTime(p.modifieLe)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
      {sansEquipement.length > 0 && (
        <Card className="mt-4">
          <h2 className="font-bold">Autres PV</h2>
          <ul>
            {sansEquipement.map((p) => (
              <li key={p.versionId}>
                <Link to={`/pv/${p.versionId}`} className="underline">
                  {p.numero}
                </Link>{" "}
                <BadgePvLocal pv={p} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
