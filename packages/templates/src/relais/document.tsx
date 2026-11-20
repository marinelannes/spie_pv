/** @jsxRuntime automatic */
/** @jsxImportSource react */
// Pragmas : le JSX est compilé en runtime automatique même quand le paquet est intégré à un bundle dont le
// tsconfig ne règle pas « jsx » (API empaquetée par tsup).
import {
  CONCLUSION_LABELS,
  SECTIONS_RELAIS,
  STATUTS_DOCUMENT,
  STATUT_DOCUMENT_LABELS,
  avancementEs,
  grouperParCarte,
  recapReserves,
  type PvDocument,
  type PvRelaisData,
} from "@spie/shared";
import { LOGO_SPIE } from "../assets.js";
import { formatDate, formatDateHeure } from "../format.js";
import {
  SectionCircuitsMesure,
  SectionConclusion,
  SectionEs,
  SectionModifications,
  SectionObservations,
  SectionProtection,
  SectionsGeneralites,
} from "./sections.js";
import { Bi, Case, Titre1 } from "./ui.js";

export interface DocumentProps {
  doc: PvDocument;
  apercu: boolean;
  signalerModifications: boolean;
}

const section = (id: (typeof SECTIONS_RELAIS)[number]["id"]) => SECTIONS_RELAIS.find((s) => s.id === id)!;

export interface EntreeSommaire {
  id: string;
  numero: string;
  fr: string;
  en: string;
  niveau: 1 | 2;
}

/** Entrées du sommaire, dans l'ordre du document (sections du modèle Word + sous-sections). */
export function entreesSommaire(signalerModifications: boolean, nbModifications: number): EntreeSommaire[] {
  const out: EntreeSommaire[] = [];
  const sous: Record<string, EntreeSommaire[]> = {
    generalites: [
      { id: "s-3-1", numero: "3.1", fr: "Objet", en: "Object", niveau: 2 },
      { id: "s-3-2", numero: "3.2", fr: "Lieu des tests", en: "Location tests", niveau: 2 },
      { id: "s-3-3", numero: "3.3", fr: "Dates des tests", en: "Date of the tests", niveau: 2 },
    ],
    mesures: [
      { id: "s-9-1", numero: "9.1", fr: "Système équilibré", en: "Balanced system", niveau: 2 },
      { id: "s-9-2", numero: "9.2", fr: "Système déséquilibré", en: "Un-balanced system", niveau: 2 },
      { id: "s-9-3", numero: "9.3", fr: "Circuits défaut terre", en: "Earth fault circuit", niveau: 2 },
    ],
    es: [
      { id: "s-10-1", numero: "10.1", fr: "Cartes E/S et remontée SCADA", en: "I/O cards and SCADA check", niveau: 2 },
      { id: "s-10-2", numero: "10.2", fr: "Affectation LED", en: "LED assignment", niveau: 2 },
    ],
    observations: [{ id: "s-12-1", numero: "12.1", fr: "Réserves", en: "Suspend items", niveau: 2 }],
  };
  for (const s of SECTIONS_RELAIS) {
    out.push({ id: `s-${s.id}`, numero: s.numero, fr: s.titreFr, en: s.titreEn, niveau: 1 });
    out.push(...(sous[s.id] ?? []));
  }
  if (signalerModifications && nbModifications > 0) {
    out.push({
      id: "s-annexe",
      numero: "A",
      fr: "Valeurs pré-remplies modifiées sur site",
      en: "Pre-filled values changed on site",
      niveau: 1,
    });
  }
  return out;
}

function Entete({ doc, apercu }: { doc: PvDocument; apercu: boolean }) {
  const e = doc.donnees.entete;
  return (
    <div className="entete">
      <table>
        <tbody>
          <tr>
            <td className="logo" rowSpan={3}>
              <img src={LOGO_SPIE} alt="SPIE" />
            </td>
            <td className="titre" rowSpan={3}>
              PV DE TEST RELAIS DE PROTECTION
              <span className="en">TEST SHEET PROTECTION RELAY</span>
            </td>
            <td className="droite">
              N° Document : <strong>{e.numeroDocument}</strong>
            </td>
          </tr>
          <tr>
            <td className="droite">
              N° AFF : <strong>{e.numeroAffaire}</strong>
            </td>
          </tr>
          <tr>
            <td className="droite statuts">
              {STATUTS_DOCUMENT.map((s) => (
                <span key={s}>
                  <Case coche={e.statutDocument === s} />
                  {s}
                </span>
              ))}
            </td>
          </tr>
          <tr>
            <td colSpan={2}>
              Projet : <strong>{e.projet}</strong>
              {doc.equipement && (
                <>
                  {" — "}Équipement : <strong>{doc.equipement.tag}</strong>
                </>
              )}
              {" — "}
              <span className="nowrap">
                PV n° <strong>{doc.pv.numero}</strong>
              </span>
            </td>
            <td className="droite">
              Révision : <strong>{e.indice}</strong>
            </td>
          </tr>
        </tbody>
      </table>
      <div className="legende">{STATUTS_DOCUMENT.map((s) => `${s} : ${STATUT_DOCUMENT_LABELS[s]}`).join(" — ")}</div>
      {apercu && <div className="apercu-bandeau">APERÇU — document non signé / PREVIEW — not signed</div>}
    </div>
  );
}

function Pied({ doc }: { doc: PvDocument }) {
  return (
    <div className="pied">
      <p className="page-num" />
      <p>
        Ce document confidentiel est la propriété de SPIE Industrie. Toute communication à des tiers doit faire l'objet
        d'un accord écrit de sa part.
      </p>
      <p>SPIE Industrie – Département Production Énergie – 64121 Serres-Castet</p>
      <p className="pv-num">{doc.pv.numero}</p>
    </div>
  );
}

const NB_LIGNES_REVISIONS = 7;

function PageDeGarde({ doc }: { doc: PvDocument }) {
  const d = doc.donnees;
  // Comme dans le modèle Word : lignes vides en haut, révisions de la plus récente à la plus ancienne, en-tête en bas.
  const revisions = [...d.revisions].reverse();
  const vides = Math.max(0, NB_LIGNES_REVISIONS - revisions.length);
  return (
    <section className="garde">
      <div className="bloc-client">
        <p>
          <span className="lib">Client / Customer :</span> {d.entete.client}
        </p>
        <p>
          <span className="lib">Projet / Project :</span> {d.entete.projet}
        </p>
        {doc.affaire.site && (
          <p>
            <span className="lib">Site :</span> {doc.affaire.site}
          </p>
        )}
      </div>
      <div className="titre-garde">
        PV DE TEST RELAIS DE PROTECTION
        <span className="en">TEST SHEET PROTECTION RELAY</span>
      </div>
      <div className="equipement">
        {doc.equipement ? (
          <>
            <strong>{doc.equipement.tag}</strong>
            {doc.equipement.libelle && <> — {doc.equipement.libelle}</>}
            <br />
          </>
        ) : null}
        PV n° <strong>{doc.pv.numero}</strong> — N° Document <strong>{d.entete.numeroDocument}</strong>
      </div>
      <table className="t revisions">
        <colgroup>
          <col style={{ width: "9%" }} />
          <col style={{ width: "13%" }} />
          <col style={{ width: "17%" }} />
          <col style={{ width: "17%" }} />
          <col style={{ width: "17%" }} />
          <col style={{ width: "27%" }} />
        </colgroup>
        <tbody>
          {Array.from({ length: vides }, (_, i) => (
            <tr key={`vide-${i}`}>
              <td />
              <td />
              <td />
              <td />
              <td />
              <td />
            </tr>
          ))}
          {revisions.map((r, i) => (
            <tr key={`${r.indice}-${i}`}>
              <td className="c">{r.indice}</td>
              <td className="c">{formatDate(r.date)}</td>
              <td>{r.ecritPar}</td>
              <td>{r.validePar}</td>
              <td>{r.approuvePar}</td>
              <td>{r.modifications}</td>
            </tr>
          ))}
          <tr>
            <th>Rév</th>
            <th>Date</th>
            <th>
              <Bi fr="Écrit par" en="Created" />
            </th>
            <th>
              <Bi fr="Validé par" en="Checked by" />
            </th>
            <th>
              <Bi fr="Approuvé par" en="Approved" />
            </th>
            <th>Modifications</th>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

function Sommaire({ entrees }: { entrees: EntreeSommaire[] }) {
  return (
    <section className="sommaire saut-avant">
      <h1>Sommaire / Summary</h1>
      <ol>
        {entrees.map((e) => (
          <li key={e.id} className={`n${e.niveau}`}>
            <a href={`#${e.id}`}>
              <span className="num">{e.numero}.</span>
              <span>
                {e.fr.toUpperCase()} / {e.en.toUpperCase()}
              </span>
              <span className="points" />
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Introduction() {
  const s1 = section("introduction");
  const s2 = section("glossaire");
  return (
    <>
      <Titre1
        id={`s-${s1.id}`}
        numero={s1.numero}
        fr={s1.titreFr.toUpperCase()}
        en={s1.titreEn.toUpperCase()}
        sautAvant
      />
      <table className="t bilingue">
        <tbody>
          <tr>
            <td>
              Ce document détaille l'ensemble des opérations de contrôles des équipements objet du Marché et réalisé sur
              le lieu de fabrication. Il est sanctionné par un constat contradictoire appelé recette en usine.
            </td>
            <td className="en">
              This procedure defines the types of checks and tests carried out during the factory tests of the
              contractual work scope supplied. It is sanctioned by a contradictory report between both parties.
            </td>
          </tr>
        </tbody>
      </table>
      <Titre1 id={`s-${s2.id}`} numero={s2.numero} fr={s2.titreFr.toUpperCase()} en={s2.titreEn.toUpperCase()} />
      <table className="t bilingue">
        <tbody>
          {[
            ["IHM", "Interface Homme Machine", "HMI", "Human Machine Interface"],
            ["NA", "Non Applicable", "NA", "Non-Applicable"],
            ["C", "Conforme", "C", "Conform"],
            ["NC", "Non Conforme", "NC", "Non-Conform"],
          ].map(([a, b, c, dd]) => (
            <tr key={a}>
              <td>
                <strong>{a}</strong> — {b}
              </td>
              <td className="en">
                <strong>{c}</strong> — {dd}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Empreinte({ doc }: { doc: PvDocument }) {
  const d: PvRelaisData = doc.donnees;
  return (
    <div className="empreinte">
      <p>
        PV n° <strong>{doc.pv.numero}</strong> — indice {d.entete.indice} — modèle {doc.pv.modele} v
        {doc.pv.modeleVersion}
        {doc.version.signeLe && <> — signé le {formatDateHeure(doc.version.signeLe)}</>}
        {doc.meta.signePar && <> par {doc.meta.signePar.nom}</>}
      </p>
      {doc.version.empreinte ? (
        <p>
          Empreinte SHA-256 des données signées / SHA-256 fingerprint : <code>{doc.version.empreinte}</code>
        </p>
      ) : (
        <p>Document non signé : l'empreinte SHA-256 sera calculée à la signature.</p>
      )}
    </div>
  );
}

/** Corps du document (sans <html>/<head>), rendu par renderPvRelaisHtml. */
export function CorpsPvRelais({ doc, apercu, signalerModifications }: DocumentProps) {
  const d = doc.donnees;
  const es = avancementEs(d.es.points);
  const reserves = recapReserves(d);
  const annexe = signalerModifications && doc.modifications.length > 0;
  return (
    <>
      <Entete doc={doc} apercu={apercu} />
      <Pied doc={doc} />
      <PageDeGarde doc={doc} />
      <Sommaire entrees={entreesSommaire(signalerModifications, doc.modifications.length)} />
      <Introduction />
      <SectionsGeneralites d={d} />
      <SectionCircuitsMesure d={d} />
      <SectionEs d={d} avancement={es} groupes={grouperParCarte(d.es.points)} />
      <SectionProtection d={d} />
      <SectionObservations d={d} recap={reserves} />
      <SectionConclusion d={d} libelles={CONCLUSION_LABELS} />
      <Empreinte doc={doc} />
      {annexe && <SectionModifications modifications={doc.modifications} />}
    </>
  );
}
