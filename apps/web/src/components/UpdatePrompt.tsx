import { useRegisterSW } from "virtual:pwa-register/react";
import { Button } from "./ui";

/**
 * Nouvelle version de l'application : proposée à l'utilisateur, jamais appliquée d'office
 * (une saisie peut être en cours, spec §6.2).
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-xl flex-wrap items-center gap-3 rounded-xl bg-slate-900 p-4 text-white shadow-lg"
    >
      <p className="flex-1">Une nouvelle version de l'application est disponible.</p>
      <Button onClick={() => void updateServiceWorker(true)}>Mettre à jour</Button>
      <Button variant="ghost" className="text-white hover:bg-slate-800" onClick={() => setNeedRefresh(false)}>
        Plus tard
      </Button>
    </div>
  );
}
