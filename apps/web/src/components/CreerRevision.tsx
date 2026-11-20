import { useId, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../lib/api";
import { useOnline } from "../lib/online";
import { creerRevisionSurTablette } from "../offline/revisions";
import { useDb } from "../offline/SyncProvider";
import { Alert, Button } from "./ui";

/** Description de la modification d'une révision (ligne du tableau des révisions) : tablette et back-office. */
export function ChampModification({ valeur, onChange }: { valeur: string; onChange: (v: string) => void }) {
  const champ = useId();
  return (
    <div>
      <label htmlFor={champ} className="mb-1 block font-semibold">
        Modification apportée (tableau des révisions)
      </label>
      <textarea
        id={champ}
        rows={2}
        maxLength={500}
        className="w-full rounded-lg border-2 border-slate-300 px-3 py-2"
        placeholder="Ex. : levée de la réserve n°1"
        value={valeur}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/**
 * « Créer la révision suivante » d'un PV déposé, sur la tablette (spec §3.4) : description de la modification, puis
 * réservation de l'indice par le serveur (réseau requis). La révision s'ouvre ensuite et se remplit hors ligne.
 */
export function CreerRevision({ pvId, numero, indice }: { pvId: string; numero: string; indice: string }) {
  const db = useDb();
  const online = useOnline();
  const navigate = useNavigate();
  const [ouvert, setOuvert] = useState(false);
  const [modifications, setModifications] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const creer = async () => {
    setErreur(null);
    setEnCours(true);
    try {
      const pv = await creerRevisionSurTablette(db, api, { pvId, modifications }, new Date());
      navigate(`/pv/${pv.versionId}`);
    } catch (err) {
      setErreur(err instanceof Error ? err.message : String(err));
    } finally {
      setEnCours(false);
    }
  };

  if (!ouvert) {
    return (
      <Button variant="secondary" onClick={() => setOuvert(true)}>
        Créer la révision {indice}
      </Button>
    );
  }
  return (
    <div className="w-full space-y-3 rounded-lg border-2 border-brand-200 bg-white p-4 text-brand-700">
      <p className="font-bold">
        Révision {indice} du PV {numero}
      </p>
      <p className="text-sm text-slate-700">
        Les données de la révision précédente sont reprises ; les signatures et le statut BPO / BPE / CMS sont à
        refaire. La révision précédente reste dans SharePoint, inchangée.
      </p>
      <ChampModification valeur={modifications} onChange={setModifications} />
      {!online && <Alert kind="warning">Hors ligne : la création d'une révision demande du réseau.</Alert>}
      {erreur && <Alert kind="error">{erreur}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button busy={enCours} disabled={!modifications.trim()} onClick={() => void creer()}>
          Créer la révision {indice}
        </Button>
        <Button variant="ghost" onClick={() => setOuvert(false)}>
          Annuler
        </Button>
      </div>
    </div>
  );
}
