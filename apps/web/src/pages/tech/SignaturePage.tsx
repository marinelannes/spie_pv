import {
  CONCLUSION_LABELS,
  STATUT_DOCUMENT_LABELS,
  controlesAvantSignature,
  controlesSignature,
  versionFigee,
  type PvRelaisData,
  type Signataire,
  type StatutDocument,
} from "@spie/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Alert, Button, Card, Loading, PageHeader } from "../../components/ui";
import { useUser } from "../../lib/auth";
import { isoDateParis } from "../../lib/format";
import { creerEnregistreurDiffere, flushALaFermeture } from "../../offline/autosave";
import type { LocalPv } from "../../offline/db";
import { PvLocalError, avecEcritPar, enregistrerDonnees, messageClotAilleurs, signerPv } from "../../offline/pv-local";
import { useDb, useSync } from "../../offline/SyncProvider";
import { EditeurContext } from "../../pv/editor/context";
import { ChampTexte, ChoixBoutons } from "../../pv/editor/fields";
import { ListeManquants } from "../../pv/editor/PvEditor";
import { SignaturePad } from "../../pv/SignaturePad";
import { usePvLocal } from "./PvPage";

/** Statut BPO / BPE / CMS, conclusion, signatures SPIE et client, validation (spec §3.2 étapes 6 à 8). */
export function SignaturePage() {
  const { versionId = "" } = useParams();
  const { pv, affaire } = usePvLocal(versionId);
  if (pv === undefined || affaire === undefined) return <Loading />;
  if (pv === null) return <Alert kind="warning">Ce PV n'est pas sur cette tablette.</Alert>;
  if (versionFigee(pv.statut) || pv.clotAilleurs) {
    return (
      <Alert kind={pv.clotAilleurs ? "warning" : "info"}>
        {pv.clotAilleurs ? messageClotAilleurs(pv.clotAilleurs) : "Ce PV est déjà signé."}{" "}
        <Link to={`/pv/${pv.versionId}`} className="underline">
          Retour au PV
        </Link>
      </Alert>
    );
  }
  return <Signature key={pv.versionId} pv={pv} />;
}

function Signature({ pv }: { pv: LocalPv }) {
  const db = useDb();
  const { synchroniser } = useSync();
  const user = useUser();
  const navigate = useNavigate();
  const aujourdhui = isoDateParis(new Date());
  // Valeurs par défaut : nom du technicien connecté, date du jour, « Écrit par » = signataire (spec §4.1).
  const [donnees, setDonnees] = useState<PvRelaisData>(() => {
    const d = avecEcritPar(pv.donnees, user.nom);
    return {
      ...d,
      signatures: {
        spie: {
          ...d.signatures.spie,
          nom: d.signatures.spie.nom || user.nom,
          date: d.signatures.spie.date || aujourdhui,
        },
        client: { ...d.signatures.client, date: d.signatures.client.date || aujourdhui },
      },
    };
  });
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const trace = useCallback(() => ({ par: user.nom, le: new Date().toISOString() }), [user.nom]);
  const enregistreur = useMemo(
    () => creerEnregistreurDiffere<PvRelaisData>((d) => enregistrerDonnees(db, pv.versionId, d, trace())),
    [db, pv.versionId, trace],
  );
  const modifie = useRef(false);
  useEffect(() => {
    const stop = flushALaFermeture(() => enregistreur.flush());
    return () => {
      stop();
      void enregistreur.flush();
    };
  }, [enregistreur]);
  useEffect(() => {
    if (modifie.current) enregistreur.planifier(donnees);
  }, [donnees, enregistreur]);
  const maj = useCallback((fn: (d: PvRelaisData) => PvRelaisData) => {
    modifie.current = true;
    setDonnees(fn);
  }, []);

  const manquants = useMemo(() => controlesAvantSignature(donnees), [donnees]);
  const bloquantsAvant = manquants.filter((m) => m.bloquant);
  const manquesSignature = useMemo(() => controlesSignature(donnees), [donnees]);
  const revision = donnees.revisions.find((r) => r.indice === donnees.entete.indice);
  const setSpie = (p: Partial<Signataire>) =>
    maj((d) => ({ ...d, signatures: { ...d.signatures, spie: { ...d.signatures.spie, ...p } } }));
  const setClient = (p: Partial<PvRelaisData["signatures"]["client"]>) =>
    maj((d) => ({ ...d, signatures: { ...d.signatures, client: { ...d.signatures.client, ...p } } }));
  const setRevision = (k: "ecritPar" | "validePar" | "approuvePar", v: string) =>
    maj((d) => ({ ...d, revisions: d.revisions.map((r) => (r.indice === d.entete.indice ? { ...r, [k]: v } : r)) }));
  const ctx = useMemo(
    () => ({ donnees, preparees: null, maj, mode: "saisie" as const, lectureSeule: false, trace }),
    [donnees, maj, trace],
  );
  const client = donnees.signatures.client;

  const valider = async () => {
    if (!window.confirm("Valider le PV ? Il sera figé : plus aucune modification ne sera possible.")) return;
    setErreur(null);
    setEnCours(true);
    try {
      await enregistreur.flush();
      await signerPv(
        db,
        pv.versionId,
        { donnees, signataire: { id: user.id, nom: donnees.signatures.spie.nom || user.nom } },
        new Date(),
      );
      void synchroniser();
      navigate(`/pv/${pv.versionId}`, { replace: true });
    } catch (err) {
      setErreur(
        err instanceof PvLocalError && err.manquants.length > 0
          ? `${err.message} ${err.manquants.map((m) => m.message).join(" ")}`
          : err instanceof Error
            ? err.message
            : String(err),
      );
    } finally {
      setEnCours(false);
    }
  };

  return (
    <EditeurContext value={ctx}>
      <PageHeader
        title={`Signature du PV ${pv.numero}`}
        subtitle={
          <Link to={`/pv/${pv.versionId}`} className="underline">
            Retour à la saisie
          </Link>
        }
      />
      <div className="space-y-5">
        {bloquantsAvant.length > 0 && (
          <Card className="border-amber-300">
            <ListeManquants manquants={manquants} onAller={(s) => navigate(`/pv/${pv.versionId}?section=${s}`)} />
          </Card>
        )}
        <Card>
          <h2 className="mb-3 text-lg font-bold">Statut du document</h2>
          <ChoixBoutons<StatutDocument>
            label="Statut du document"
            valeur={donnees.entete.statutDocument}
            options={["BPO", "BPE", "CMS"]}
            titres={STATUT_DOCUMENT_LABELS}
            onChange={(statutDocument) => maj((d) => ({ ...d, entete: { ...d.entete, statutDocument } }))}
          />
          {donnees.entete.statutDocument && (
            <p className="mt-2 text-slate-700">{STATUT_DOCUMENT_LABELS[donnees.entete.statutDocument]}</p>
          )}
          <h2 className="mb-3 mt-5 text-lg font-bold">Conclusion générale</h2>
          <ChoixBoutons
            label="Conclusion générale"
            valeur={
              donnees.conclusion.materiel === "accepte"
                ? "Accepté"
                : donnees.conclusion.materiel === "refuse"
                  ? "Refusé"
                  : null
            }
            options={["Accepté", "Refusé"] as const}
            titres={{ Accepté: CONCLUSION_LABELS.accepte, Refusé: CONCLUSION_LABELS.refuse }}
            onChange={(v) =>
              maj((d) => ({
                ...d,
                conclusion: { materiel: v === "Accepté" ? "accepte" : v === "Refusé" ? "refuse" : null },
              }))
            }
          />
        </Card>
        <Card>
          <h2 className="mb-3 text-lg font-bold">Révision {donnees.entete.indice} — noms</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <ChampTexte
              label="Écrit par"
              valeur={revision?.ecritPar ?? ""}
              onChange={(v) => setRevision("ecritPar", v)}
            />
            <ChampTexte
              label="Validé par"
              valeur={revision?.validePar ?? ""}
              onChange={(v) => setRevision("validePar", v)}
            />
            <ChampTexte
              label="Approuvé par"
              valeur={revision?.approuvePar ?? ""}
              onChange={(v) => setRevision("approuvePar", v)}
            />
          </div>
        </Card>
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <h2 className="mb-3 text-lg font-bold">SPIE Industrie</h2>
            <div className="space-y-3">
              <ChampTexte label="Nom" valeur={donnees.signatures.spie.nom} onChange={(nom) => setSpie({ nom })} />
              <label className="block font-medium">
                Date
                <input
                  type="date"
                  className="mt-1 block min-h-12 w-full rounded-lg border-2 border-slate-300 px-3"
                  value={donnees.signatures.spie.date}
                  onChange={(e) => setSpie({ date: e.target.value })}
                />
              </label>
              <SignaturePad
                label="Signature SPIE"
                valeur={donnees.signatures.spie.signature}
                onChange={(signature) => setSpie({ signature })}
              />
              <ChampTexte
                label="Commentaires"
                multiligne
                valeur={donnees.signatures.spie.commentaires}
                onChange={(commentaires) => setSpie({ commentaires })}
              />
            </div>
          </Card>
          <Card>
            <h2 className="mb-3 text-lg font-bold">Client</h2>
            <label className="mb-3 flex min-h-12 items-center gap-3 font-medium">
              <input
                type="checkbox"
                className="size-6"
                checked={client.refus !== null}
                onChange={(e) => setClient({ refus: e.target.checked ? { motif: "" } : null })}
              />
              Le client refuse de signer
            </label>
            <div className="space-y-3">
              <ChampTexte label="Nom" valeur={client.nom} onChange={(nom) => setClient({ nom })} />
              <label className="block font-medium">
                {client.refus ? "Date du refus" : "Date"}
                <input
                  type="date"
                  className="mt-1 block min-h-12 w-full rounded-lg border-2 border-slate-300 px-3"
                  value={client.date}
                  onChange={(e) => setClient({ date: e.target.value })}
                />
              </label>
              {client.refus ? (
                <ChampTexte
                  label="Motif du refus de signer"
                  multiligne
                  valeur={client.refus.motif}
                  onChange={(motif) => setClient({ refus: { motif } })}
                />
              ) : (
                <SignaturePad
                  label="Visa / signature du client"
                  valeur={client.signature}
                  onChange={(signature) => setClient({ signature })}
                />
              )}
              <ChampTexte
                label="Commentaires"
                multiligne
                valeur={client.commentaires}
                onChange={(commentaires) => setClient({ commentaires })}
              />
            </div>
          </Card>
        </div>
        {erreur && <Alert kind="error">{erreur}</Alert>}
        {manquesSignature.length > 0 && (
          <Alert kind="warning">
            <ul className="list-disc pl-5">
              {manquesSignature.map((m) => (
                <li key={m.ref}>{m.message}</li>
              ))}
            </ul>
          </Alert>
        )}
        <Button
          className="w-full sm:w-auto"
          busy={enCours}
          disabled={bloquantsAvant.length > 0 || manquesSignature.length > 0}
          onClick={() => void valider()}
        >
          Valider et figer le PV
        </Button>
      </div>
    </EditeurContext>
  );
}
