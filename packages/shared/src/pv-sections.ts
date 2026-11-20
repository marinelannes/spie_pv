/**
 * Structure du modèle « PV de test relais de protection » (spec §4.5) : sections numérotées comme dans le modèle Word.
 * Sert à la navigation du formulaire (tablette et préparation), au sommaire du PDF et au regroupement des contrôles.
 */
export const SECTIONS_RELAIS = [
  { id: "introduction", numero: "1", titreFr: "Introduction", titreEn: "Introduction", saisie: false },
  { id: "glossaire", numero: "2", titreFr: "Glossaire", titreEn: "Glossary", saisie: false },
  { id: "generalites", numero: "3", titreFr: "Généralités", titreEn: "General", saisie: true },
  { id: "materiel", numero: "4", titreFr: "Matériel de test", titreEn: "Test equipment", saisie: true },
  { id: "documents", numero: "5", titreFr: "Documents de référence", titreEn: "Reference document", saisie: true },
  {
    id: "identification",
    numero: "6",
    titreFr: "Identification du relais",
    titreEn: "Relay identification",
    saisie: true,
  },
  { id: "tests", numero: "7", titreFr: "Tests préliminaires", titreEn: "Preliminary tests", saisie: true },
  {
    id: "configuration",
    numero: "8",
    titreFr: "Identification de la configuration",
    titreEn: "Configuration identification",
    saisie: true,
  },
  {
    id: "mesures",
    numero: "9",
    titreFr: "Vérification des circuits de mesures",
    titreEn: "Verification of the measuring circuits",
    saisie: true,
  },
  { id: "es", numero: "10", titreFr: "Affectation cartes E/S", titreEn: "I/O assignment", saisie: true },
  { id: "protection", numero: "11", titreFr: "Plan de protection", titreEn: "Protection scheme study", saisie: true },
  { id: "observations", numero: "12", titreFr: "Observations", titreEn: "Comments", saisie: true },
  {
    id: "conclusion",
    numero: "13",
    titreFr: "Conclusion générale des tests",
    titreEn: "General test conclusion",
    saisie: true,
  },
] as const;

export type SectionRelaisId = (typeof SECTIONS_RELAIS)[number]["id"];

export function sectionRelais(id: SectionRelaisId) {
  return SECTIONS_RELAIS.find((s) => s.id === id)!;
}
