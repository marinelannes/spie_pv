import {
  associationEquipementSchema,
  normaliserTexte,
  type AnomalieImport,
  type AssociationEquipement,
  type AssociationEquipementInput,
  type FeuilleEsLue,
  type IoImportAnalyseDto,
  type ListeEsLue,
} from "@spie/shared";

/** Nom de la feuille des équipements, rattaché aux anomalies d'association. */
const FEUILLE_EQUIPEMENTS = "LISTE DES EQUIPEMENTS";

/** Association actuelle d'un équipement déjà enregistré (version précédente de la liste, ou « Changer »). */
export interface AssociationActuelle {
  tag: string;
  typeCellule: string;
  /** Nom de la feuille associée, null : aucune. */
  feuille: string | null;
  filtreTag: string | null;
}

/**
 * Associations à reprendre au ré-import (spec §4.6) : celles que le préparateur a choisies à la main, c'est-à-dire
 * une feuille différente du TYPE CELLULE ou restreinte à un groupe TAG. Une association obtenue par le TYPE CELLULE
 * n'est pas reprise : la règle automatique s'applique de nouveau au nouveau fichier (TYPE CELLULE éventuellement modifié).
 */
export function associationsAReprendre(actuelles: readonly AssociationActuelle[]): AssociationEquipementInput[] {
  return actuelles
    .filter((a) => a.feuille !== null && (normaliserTexte(a.feuille) !== normaliserTexte(a.typeCellule) || a.filtreTag))
    .map((a) => ({ tag: a.tag, feuille: a.feuille, filtreTag: a.filtreTag }));
}

/**
 * Association équipement ↔ feuille d'E/S (spec §4.4) :
 * 1. choix du préparateur pour ce TAG (mode « manuel »), avec un filtre facultatif sur la colonne TAG de la feuille ;
 * 2. sinon, choix manuel de la version précédente de la liste (mode « reprise »), si la feuille existe toujours ;
 * 3. sinon, feuille dont le nom est le TYPE CELLULE de l'équipement (ex. `TYPE BATTERIE`, mode « auto ») ;
 * 4. sinon, aucune feuille (avertissement) : relais HTB de type cellule « HTB », régulateur au type cellule vide,
 *    protection bobine point neutre…
 */
export function proposerAssociations(
  lue: ListeEsLue,
  choix?: AssociationEquipementInput[],
  precedentes?: AssociationEquipementInput[],
): { associations: AssociationEquipement[]; anomalies: AnomalieImport[] } {
  const anomalies: AnomalieImport[] = [];
  const parNom = new Map<string, FeuilleEsLue>();
  for (const f of lue.feuilles) parNom.set(normaliserTexte(f.nom), f);
  const parTag = (liste?: AssociationEquipementInput[]) =>
    new Map(
      (liste ?? []).map((c) => {
        const p = associationEquipementSchema.parse(c);
        return [normaliserTexte(p.tag), p] as const;
      }),
    );
  const choixParTag = parTag(choix);
  const precedentesParTag = parTag(precedentes);

  const associations = lue.equipements.map((eq): AssociationEquipement => {
    const anomalie = (severite: AnomalieImport["severite"], code: AnomalieImport["code"], message: string) =>
      anomalies.push({ code, severite, feuille: FEUILLE_EQUIPEMENTS, ligne: eq.ligne, message });
    const filtrer = (f: FeuilleEsLue, filtreTag: string | null) => {
      const filtre = filtreTag?.trim() || null;
      if (filtre && !f.groupesTag.includes(filtre)) {
        anomalie(
          "avertissement",
          "filtre_tag_inconnu",
          `${eq.tag} : le filtre TAG « ${filtre} » n'existe pas dans la feuille « ${f.nom} » : aucune E/S retenue.`,
        );
      }
      return filtre;
    };

    const c = choixParTag.get(normaliserTexte(eq.tag));
    if (c) {
      if (c.feuille === null) {
        anomalie("avertissement", "equipement_sans_feuille", `${eq.tag} : aucune feuille d'E/S choisie.`);
        return { tag: eq.tag, feuille: null, filtreTag: null, mode: "aucune" };
      }
      const f = parNom.get(normaliserTexte(c.feuille));
      if (!f) {
        anomalie("erreur", "feuille_inconnue", `${eq.tag} : la feuille « ${c.feuille} » n'existe pas dans le fichier.`);
        return { tag: eq.tag, feuille: null, filtreTag: null, mode: "aucune" };
      }
      return { tag: eq.tag, feuille: f.nom, filtreTag: filtrer(f, c.filtreTag), mode: "manuel" };
    }

    let precedenteAbsente = false;
    const p = precedentesParTag.get(normaliserTexte(eq.tag));
    if (p?.feuille) {
      const f = parNom.get(normaliserTexte(p.feuille));
      if (f) return { tag: eq.tag, feuille: f.nom, filtreTag: filtrer(f, p.filtreTag), mode: "reprise" };
      precedenteAbsente = true;
      anomalie(
        "avertissement",
        "feuille_precedente_absente",
        `${eq.tag} : la feuille « ${p.feuille} » associée dans la version précédente n'existe plus : choisir la feuille d'E/S.`,
      );
    }

    const auto = eq.typeCellule ? parNom.get(normaliserTexte(eq.typeCellule)) : undefined;
    if (auto) return { tag: eq.tag, feuille: auto.nom, filtreTag: null, mode: "auto" };

    if (!precedenteAbsente) {
      anomalie(
        "avertissement",
        "equipement_sans_feuille",
        eq.typeCellule
          ? `${eq.tag} : aucune feuille « ${eq.typeCellule} » (TYPE CELLULE) : choisir la feuille d'E/S.`
          : `${eq.tag} : TYPE CELLULE vide : choisir la feuille d'E/S.`,
      );
    }
    return { tag: eq.tag, feuille: null, filtreTag: null, mode: "aucune" };
  });

  return { associations, anomalies };
}

/** Rapport d'analyse renvoyé au back-office avant l'import : lecture, associations, anomalies. */
export function analyserImport(
  lue: ListeEsLue,
  fichier: string,
  choix?: AssociationEquipementInput[],
  precedentes?: AssociationEquipementInput[],
): IoImportAnalyseDto {
  const { associations, anomalies } = proposerAssociations(lue, choix, precedentes);
  const toutes = [...lue.anomalies, ...anomalies];
  return {
    fichier,
    reference: lue.reference,
    revision: lue.revision,
    numeroAffaire: lue.numeroAffaire,
    equipements: lue.equipements.map((eq, i) => ({ ...eq, association: associations[i]! })),
    feuilles: lue.feuilles.map((f) => ({
      nom: f.nom,
      titre: f.titre,
      nbPoints: f.points.length,
      nbReserves: f.points.filter((p) => p.reserve).length,
      groupesTag: f.groupesTag,
    })),
    anomalies: toutes,
    bloquant: toutes.some((a) => a.severite === "erreur"),
  };
}
