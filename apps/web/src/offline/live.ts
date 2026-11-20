import { liveQuery } from "dexie";
import { useEffect, useState } from "react";

/**
 * Résultat d'une requête Dexie, mis à jour à chaque modification de la base. `undefined` pendant le premier
 * chargement. Les dépendances relancent l'abonnement.
 */
export function useLive<T>(query: () => Promise<T>, deps: readonly unknown[]): T | undefined {
  const [value, setValue] = useState<{ v: T } | undefined>(undefined);
  useEffect(() => {
    const sub = liveQuery(query).subscribe({
      next: (v) => setValue({ v }),
      error: (err) => console.error("Base locale :", err),
    });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value?.v;
}
