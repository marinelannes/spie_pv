import { useEffect, useState } from "react";
import { Link } from "react-router";
import { formatDateTime, formatOctets } from "../lib/format";
import { useAuth } from "../lib/auth";
import { metaEnLecture } from "../offline/db";
import { useLive } from "../offline/live";
import { useSync } from "../offline/SyncProvider";
import { Alert, Button, Card } from "./ui";

function useStockage(): { utilise: number | null; quota: number | null; persistant: boolean | null } {
  const [s, setS] = useState<{ utilise: number | null; quota: number | null; persistant: boolean | null }>({
    utilise: null,
    quota: null,
    persistant: null,
  });
  useEffect(() => {
    let actif = true;
    void (async () => {
      const est = await navigator.storage?.estimate?.().catch(() => null);
      const persistant = (await navigator.storage?.persisted?.().catch(() => null)) ?? null;
      if (actif) setS({ utilise: est?.usage ?? null, quota: est?.quota ?? null, persistant });
    })();
    return () => {
      actif = false;
    };
  }, []);
  return s;
}

/** « Prêt pour le hors ligne » (spec §3.1 étape 5), file d'envoi, espace utilisé (spec §6.2). */
export function SyncStatus() {
  const { db, engine, enCours, dernier, synchroniser } = useSync();
  const { state, retry } = useAuth();
  const meta = useLive(() => metaEnLecture(db), [db]);
  const enAttente = useLive(() => db.outbox.count(), [db]);
  const bloques = useLive(() => db.outbox.filter((o) => o.bloque).count(), [db]);
  const stockage = useStockage();
  const pret = Boolean(meta?.derniereSynchro);

  return (
    <Card className={pret ? "border-green-300" : "border-amber-300"}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className={`text-xl font-bold ${pret ? "text-green-800" : "text-amber-800"}`}>
            {pret ? "Prêt pour le hors ligne" : "Pas encore synchronisé"}
          </p>
          <p className="text-slate-700">Dernière synchronisation : {formatDateTime(meta?.derniereSynchro)}</p>
          <p className="text-slate-700">
            PV en attente d'envoi : <strong>{enAttente ?? "…"}</strong>
            {bloques ? <span className="ml-2 font-semibold text-red-800">({bloques} refusé(s))</span> : null}
          </p>
          <p className="text-sm text-slate-600">
            Espace utilisé : {formatOctets(stockage.utilise)}
            {stockage.quota ? ` sur ${formatOctets(stockage.quota)}` : ""}
            {stockage.persistant === false &&
              " — stockage non persistant : installez l'application sur l'écran d'accueil."}
          </p>
        </div>
        {engine ? (
          <Button onClick={() => void synchroniser()} busy={enCours}>
            Synchroniser
          </Button>
        ) : (
          <Button variant="secondary" onClick={retry}>
            Se reconnecter
          </Button>
        )}
      </div>
      {state.status === "offline" && (
        <div className="mt-3">
          <Alert kind="warning">
            Mode hors ligne : la saisie et la signature restent possibles ; l'envoi reprendra après reconnexion.
          </Alert>
        </div>
      )}
      {dernier?.message && (
        <div className="mt-3">
          <Alert kind={dernier.authRequise || dernier.refuses > 0 ? "error" : "warning"}>
            {dernier.message}
            {dernier.authRequise && (
              <>
                {" "}
                <Link to="/connexion" className="font-semibold underline">
                  Se reconnecter
                </Link>
              </>
            )}
          </Alert>
        </div>
      )}
    </Card>
  );
}
