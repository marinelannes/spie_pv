import { controlesAvantSignature, versionFigee, type PvRelaisData, type SectionRelaisId } from "@spie/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { CreerRevision } from "../../components/CreerRevision";
import { BadgePvLocal, BadgesDepots, LiensSharePoint } from "../../components/statuts";
import { Alert, Button, Loading } from "../../components/ui";
import { useUser } from "../../lib/auth";
import { formatDateTime } from "../../lib/format";
import { creerEnregistreurDiffere, flushALaFermeture } from "../../offline/autosave";
import type { LocalAffaire, LocalPv } from "../../offline/db";
import { useLive } from "../../offline/live";
import {
  enregistrerDonnees,
  listeEsObsolete,
  messageClotAilleurs,
  ouvrirPvPrepare,
  retirerPvClotAilleurs,
  supprimerBrouillonSite,
} from "../../offline/pv-local";
import { revisionACreer, revisionLocaleSuivante } from "../../offline/revisions";
import { useDb, useSync } from "../../offline/SyncProvider";
import type { MajPv } from "../../pv/editor/context";
import { ListeManquants, PvEditor, estSectionEditable } from "../../pv/editor/PvEditor";

/** Chargement d'un PV local et de son affaire ; null si absent de la tablette. */
export function usePvLocal(versionId: string) {
  const db = useDb();
  const pv = useLive(() => db.pvs.get(versionId).then((p) => p ?? null), [db, versionId]);
  const affaire = useLive(
    () => (pv ? db.affaires.get(pv.affaireId).then((a) => a ?? null) : Promise.resolve(null)),
    [db, pv?.affaireId],
  );
  return { pv, affaire };
}

export function PvPage() {
  const { versionId = "" } = useParams();
  const { pv, affaire } = usePvLocal(versionId);
  if (pv === undefined || affaire === undefined) return <Loading />;
  if (pv === null) return <Alert kind="warning">Ce PV n'est pas sur cette tablette.</Alert>;
  return <EditeurLocal key={pv.versionId} pvInitial={pv} affaire={affaire} />;
}

/** PV déposé : accès à la révision suivante si elle est sur la tablette, sinon proposition de la créer (spec §3.4). */
function RevisionSuivante({ pv, affaire }: { pv: LocalPv; affaire: LocalAffaire | null }) {
  const db = useDb();
  const versions = useLive(() => db.pvs.where("pvId").equals(pv.pvId).toArray(), [db, pv.pvId]);
  if (!versions) return null;
  const suivante = revisionLocaleSuivante(pv, versions);
  if (suivante) {
    return (
      <Alert kind="info">
        Ce PV a une révision plus récente sur cette tablette :{" "}
        <Link to={`/pv/${suivante.versionId}`} className="font-semibold underline">
          ouvrir la révision {suivante.indice}
        </Link>
        .
      </Alert>
    );
  }
  const r = revisionACreer(pv, affaire);
  if (!r) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
      <p className="min-w-64 flex-1">
        <span className="font-bold">Révision suivante.</span>{" "}
        {r.baseAilleurs &&
          `La révision ${r.base} de ce PV a été déposée depuis une autre tablette : la révision ${r.indice} en repartira, pas de la révision ${pv.indice} affichée ici. `}
        {r.reservesOuvertes > 0
          ? `${r.reservesOuvertes} réserve(s) ouverte(s) : la révision ${r.indice} permet de les lever.`
          : `Pour corriger ou compléter ce PV, créez la révision ${r.indice}.`}
      </p>
      <CreerRevision pvId={pv.pvId} numero={pv.numero} indice={r.indice} />
    </div>
  );
}

function EditeurLocal({ pvInitial, affaire }: { pvInitial: LocalPv; affaire: LocalAffaire | null }) {
  const db = useDb();
  const { engine } = useSync();
  const user = useUser();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const section: SectionRelaisId = estSectionEditable(params.get("section"))
    ? (params.get("section") as SectionRelaisId)
    : "generalites";
  const id = pvInitial.versionId;
  // Copie vivante (statut, dépôts, erreurs) ; les données éditées restent dans l'état local.
  const pv = useLive(() => db.pvs.get(id), [db, id]) ?? pvInitial;
  const outbox = useLive(() => db.outbox.get(id).then((o) => o ?? null), [db, id]);
  const [donnees, setDonnees] = useState<PvRelaisData>(pvInitial.donnees);
  const [etat, setEtat] = useState<"enregistre" | "en_attente" | "erreur">("enregistre");
  const [erreur, setErreur] = useState<string | null>(null);
  const [voirManques, setVoirManques] = useState(false);
  const fige = versionFigee(pv.statut);
  // Signé depuis une autre tablette (PV affecté à plusieurs techniciens) : plus de saisie ni de signature ici.
  const clos = Boolean(pv.clotAilleurs);
  const modifiable = !fige && !clos;
  const modifie = useRef(false);

  const trace = useCallback(() => ({ par: user.nom, le: new Date().toISOString() }), [user.nom]);
  const enregistreur = useMemo(
    () =>
      creerEnregistreurDiffere<PvRelaisData>(
        async (d) => {
          await enregistrerDonnees(db, id, d, trace());
          setEtat("enregistre");
        },
        250,
        (err) => {
          setEtat("erreur");
          setErreur(err instanceof Error ? err.message : String(err));
        },
      ),
    [db, id, trace],
  );

  useEffect(() => {
    // Ouverture d'un PV préparé : il passe en cours de saisie (spec §6.4).
    if (pvInitial.statut === "prepare") void ouvrirPvPrepare(db, id, new Date());
  }, [db, id, pvInitial.statut]);

  useEffect(() => {
    const stop = flushALaFermeture(() => enregistreur.flush());
    return () => {
      stop();
      void enregistreur.flush();
    };
  }, [enregistreur]);

  useEffect(() => {
    if (!modifie.current) return;
    setEtat("en_attente");
    enregistreur.planifier(donnees);
  }, [donnees, enregistreur]);

  const maj: MajPv = useCallback((fn) => {
    modifie.current = true;
    setDonnees((d) => fn(d));
  }, []);

  const manquants = useMemo(() => controlesAvantSignature(donnees), [donnees]);
  const bloquants = manquants.filter((m) => m.bloquant).length;
  const eq = affaire?.equipements.find((e) => e.id === pv.equipementId);
  const allerA = (s: SectionRelaisId) => {
    setVoirManques(false);
    setParams({ section: s });
    window.scrollTo({ top: 0 });
  };
  const aller = async (chemin: string) => {
    await enregistreur.flush();
    navigate(chemin);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase text-brand-700">
            <Link to={`/affaires/${pv.affaireId}`} className="underline">
              {affaire?.affaire.numero ?? donnees.entete.numeroAffaire}
            </Link>{" "}
            — {eq?.tag ?? "équipement"}
          </p>
          <h1 className="font-mono text-2xl font-bold">{pv.numero}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2">
            <BadgePvLocal pv={pv} />
            <span>Indice {pv.indice}</span>
            {modifiable && (
              <span className="text-sm text-slate-600" aria-live="polite">
                {etat === "enregistre"
                  ? "Enregistré sur la tablette"
                  : etat === "en_attente"
                    ? "Enregistrement…"
                    : "Erreur d'enregistrement"}
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void aller(`/pv/${id}/apercu`)}>
            Aperçu
          </Button>
          {modifiable && (
            <>
              <Button variant="secondary" onClick={() => setVoirManques((v) => !v)}>
                Ce qui manque ({bloquants})
              </Button>
              <Button onClick={() => void aller(`/pv/${id}/signature`)}>Signer</Button>
            </>
          )}
        </div>
      </div>

      {pv.clotAilleurs && (
        <Alert kind="warning">
          <p className="font-semibold">{messageClotAilleurs(pv.clotAilleurs)}</p>
          <p className="mt-1">
            Le PV signé est consultable dans le suivi du bureau. La saisie ci-dessous reste lisible jusqu'au retrait de
            la tablette.
          </p>
          <Button
            variant="secondary"
            className="mt-3"
            onClick={async () => {
              if (!window.confirm(`Retirer le PV ${pv.numero} de cette tablette ? La saisie faite ici sera perdue.`)) {
                return;
              }
              await retirerPvClotAilleurs(db, id);
              navigate(`/affaires/${pv.affaireId}`, { replace: true });
            }}
          >
            Retirer de la tablette
          </Button>
        </Alert>
      )}
      {erreur && <Alert kind="error">Enregistrement local impossible : {erreur}</Alert>}
      {/* Utile seulement tant que la saisie est possible : un PV signé ou clos garde sa version, sans alerte. */}
      {modifiable && listeEsObsolete(pv, affaire ?? undefined) && (
        <Alert kind="warning">
          La liste E/S de l'affaire a été mise à jour (version {affaire?.liste?.version}) : ce PV garde la version{" "}
          {donnees.es.listeVersion} qu'il a utilisée.
        </Alert>
      )}
      {pv.versionBureauIgnoree && modifiable && (
        <Alert kind="info">
          Le bureau a modifié la préparation de ce PV le {formatDateTime(pv.versionBureauIgnoree)}. La saisie étant
          commencée, la version de la tablette fait foi.
        </Alert>
      )}
      {pv.alerteDoublon && (
        <Alert kind="warning">Un autre PV de l'affaire porte le même numéro : l'administrateur a été alerté.</Alert>
      )}
      {pv.erreurEnvoi && (
        <Alert kind="error">
          {pv.erreurEnvoi}
          {outbox?.bloque && engine && (
            <Button variant="secondary" className="ml-3" onClick={() => void engine.reessayer(id)}>
              Réessayer l'envoi
            </Button>
          )}
        </Alert>
      )}
      {fige && (
        <Alert kind={pv.statut === "depose" ? "success" : "info"}>
          PV signé le {formatDateTime(pv.signeLe)} par {pv.signePar} : il ne peut plus être modifié.
          {pv.empreinte && (
            <span className="block break-all font-mono text-sm">Empreinte SHA-256 : {pv.empreinte}</span>
          )}
          {pv.depots.length > 0 && (
            <span className="mt-2 block">
              <BadgesDepots depots={pv.depots} />
            </span>
          )}
          <LiensSharePoint depots={pv.depots} className="mt-1 flex flex-wrap gap-x-4" />
        </Alert>
      )}
      {pv.statut === "depose" && <RevisionSuivante pv={pv} affaire={affaire} />}
      {voirManques && modifiable && (
        <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
          <ListeManquants manquants={manquants} onAller={allerA} />
        </div>
      )}

      <PvEditor
        donnees={donnees}
        preparees={pv.donneesPreparees}
        mode="saisie"
        lectureSeule={!modifiable}
        onChange={maj}
        trace={trace}
        section={section}
        onSection={allerA}
      />

      {pv.origine === "site" && pv.statut === "brouillon" && (
        <div className="border-t border-slate-200 pt-4">
          <Button
            variant="danger"
            onClick={async () => {
              if (!window.confirm(`Supprimer définitivement le brouillon ${pv.numero} de cette tablette ?`)) return;
              await supprimerBrouillonSite(db, id);
              navigate(`/affaires/${pv.affaireId}`, { replace: true });
            }}
          >
            Supprimer ce brouillon
          </Button>
        </div>
      )}
    </div>
  );
}
