/**
 * Enregistrement local différé (anti-rebond) : chaque modification est enregistrée en moins de `delaiMs`, et
 * immédiatement à la fermeture ou à la mise en arrière-plan de l'application (`flush`), pour ne rien perdre
 * en cas de fermeture brutale (spec §6.1).
 */
export interface EnregistreurDiffere<T> {
  planifier(valeur: T): void;
  flush(): Promise<void>;
  /** Une valeur attend d'être enregistrée. */
  readonly enAttente: boolean;
}

export function creerEnregistreurDiffere<T>(
  enregistrer: (valeur: T) => Promise<unknown>,
  delaiMs = 250,
  onErreur: (err: unknown) => void = () => undefined,
): EnregistreurDiffere<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let derniere: { valeur: T } | null = null;
  let chaine: Promise<void> = Promise.resolve();

  const ecrire = (): Promise<void> => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const a = derniere;
    derniere = null;
    if (!a) return chaine;
    // Les écritures sont enchaînées : la dernière valeur est toujours écrite en dernier.
    chaine = chaine
      .then(() => enregistrer(a.valeur))
      .then(
        () => undefined,
        (err: unknown) => onErreur(err),
      );
    return chaine;
  };

  return {
    planifier(valeur) {
      derniere = { valeur };
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void ecrire(), delaiMs);
    },
    flush: ecrire,
    get enAttente() {
      return derniere !== null;
    },
  };
}

/** Écrit tout de suite quand la page est masquée ou fermée. Renvoie la fonction de désinscription. */
export function flushALaFermeture(flush: () => unknown, win: Window = window, doc: Document = document): () => void {
  const onHide = () => void flush();
  const onVisibility = () => {
    if (doc.visibilityState === "hidden") void flush();
  };
  win.addEventListener("pagehide", onHide);
  doc.addEventListener("visibilitychange", onVisibility);
  return () => {
    win.removeEventListener("pagehide", onHide);
    doc.removeEventListener("visibilitychange", onVisibility);
  };
}
