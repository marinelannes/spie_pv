/** @jsxRuntime automatic */
/** @jsxImportSource react */
// Pragmas : le JSX est compilé en runtime automatique même quand le paquet est intégré à un bundle dont le
// tsconfig ne règle pas « jsx » (API empaquetée par tsup).
import {
  CRITICITE_LABELS,
  SECTIONS_RELAIS,
  TYPE_ES_COURTS,
  type AvancementEs,
  type Conclusion,
  type FonctionProtection,
  type LigneBilingue,
  type ModificationTracee,
  type PointEsPv,
  type PvRelaisData,
  type TableauInjection,
} from "@spie/shared";
import { SCHEMA_TORE } from "../assets.js";
import { formatAngle, formatDate, formatDateHeure, formatNombre, formatPhaseur, formatValeur } from "../format.js";
import { Bi, Case, JugementTd, Titre1, Titre2, Val } from "./ui.js";

const sec = (id: (typeof SECTIONS_RELAIS)[number]["id"]) => SECTIONS_RELAIS.find((s) => s.id === id)!;

function T1({ id, sautAvant }: { id: (typeof SECTIONS_RELAIS)[number]["id"]; sautAvant?: boolean }) {
  const s = sec(id);
  return (
    <Titre1
      id={`s-${s.id}`}
      numero={s.numero}
      fr={s.titreFr.toUpperCase()}
      en={s.titreEn.toUpperCase()}
      sautAvant={sautAvant}
    />
  );
}

function TableBilingue({ lignes, vide }: { lignes: LigneBilingue[]; vide: string }) {
  if (lignes.length === 0) return <p className="vide">{vide}</p>;
  return (
    <table className="t bilingue">
      <tbody>
        {lignes.map((l) => (
          <tr key={l.id}>
            <td>{l.fr}</td>
            <td className="en">{l.en}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Sections 3 à 8 : généralités, matériel, documents, identification, tests préliminaires, configuration. */
export function SectionsGeneralites({ d }: { d: PvRelaisData }) {
  return (
    <>
      <T1 id="generalites" sautAvant />
      <Titre2 id="s-3-1" numero="3.1">
        <Bi fr="OBJET" en="OBJECT" />
      </Titre2>
      <TableBilingue lignes={d.generalites.objet} vide="—" />
      <Titre2 id="s-3-2" numero="3.2">
        <Bi fr="LIEU DES TESTS" en="LOCATION TESTS" />
      </Titre2>
      <table className="t bilingue">
        <tbody>
          <tr>
            <td>
              Les tests d'armoire sont réalisés sur le site de : <strong>{d.generalites.lieu}</strong>
            </td>
            <td className="en">
              The tests are realized at: <strong>{d.generalites.lieu}</strong>
            </td>
          </tr>
        </tbody>
      </table>
      <Titre2 id="s-3-3" numero="3.3">
        <Bi fr="DATES DES TESTS" en="DATE OF THE TESTS" />
      </Titre2>
      <table className="t bilingue">
        <tbody>
          <tr>
            <td>
              Les tests sont réalisés : <strong>{d.generalites.dates}</strong>
            </td>
            <td className="en">
              The tests are conducted: <strong>{d.generalites.dates}</strong>
            </td>
          </tr>
        </tbody>
      </table>

      <T1 id="materiel" />
      <TableBilingue lignes={d.materielTest} vide="Aucun matériel de test renseigné." />

      <T1 id="documents" />
      <TableBilingue lignes={d.documentsReference} vide="Aucun document de référence renseigné." />

      <T1 id="identification" sautAvant />
      <table className="t ident">
        <tbody>
          {d.identification.map((f) => (
            <tr key={f.id}>
              <td>
                <Bi fr={f.libelleFr} en={f.libelleEn} />
              </td>
              <td>
                <Val v={f.valeur} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <T1 id="tests" />
      <table className="t">
        <colgroup>
          <col style={{ width: "62%" }} />
          <col style={{ width: "26%" }} />
          <col style={{ width: "12%" }} />
        </colgroup>
        <thead>
          <tr>
            <th>
              <Bi fr="Contrôle" en="Check" />
            </th>
            <th>
              <Bi fr="Valeur relevée" en="Measured" />
            </th>
            <th>Concl.</th>
          </tr>
        </thead>
        <tbody>
          {d.testsPreliminaires.map((t) => (
            <tr key={t.id}>
              <td>
                <span className="libelle">{t.libelleFr}</span> / <span className="en">{t.libelleEn}</span>
                {(t.aideFr || t.aideEn) && (
                  <div className="note">
                    ({t.aideFr}
                    {t.aideEn && <span className="en"> / {t.aideEn}</span>})
                  </div>
                )}
                {t.observation && <div className="note">Obs. : {t.observation}</div>}
              </td>
              <td className="c">{t.valeur}</td>
              <JugementTd valeur={t.jugement} />
            </tr>
          ))}
        </tbody>
      </table>

      <T1 id="configuration" />
      <table className="t">
        <tbody>
          <tr>
            <td style={{ width: "40%" }} className="libelle">
              Nom fichier paramétrage / <span className="en">Parameters filename</span>
            </td>
            <td>{d.configuration.nomFichier}</td>
            <JugementTd valeur={d.configuration.jugement} />
          </tr>
        </tbody>
      </table>
    </>
  );
}

function TableauInjectionVue({ t }: { t: TableauInjection }) {
  return (
    <div className="insecable">
      <p className="note">
        (Injections secondaires U &amp; I sur boîtiers ESSAILEC /{" "}
        <span className="en">Secondary injections Volt/Current through testing sockets ESSAILEC</span>)
      </p>
      <table className="t">
        <colgroup>
          <col style={{ width: "10%" }} />
          <col style={{ width: "19.5%" }} />
          <col style={{ width: "19.5%" }} />
          <col style={{ width: "19.5%" }} />
          <col style={{ width: "19.5%" }} />
          <col style={{ width: "12%" }} />
        </colgroup>
        <thead>
          <tr>
            <th rowSpan={2}>Phase</th>
            <th colSpan={2}>
              <Bi fr="Valeurs injectées (*)" en="Injected (*)" />
            </th>
            <th colSpan={2}>
              <Bi fr="Valeurs mesurées (**)" en="Measured (**)" />
            </th>
            <th rowSpan={2}>Concl.</th>
          </tr>
          <tr>
            <th>V</th>
            <th>I</th>
            <th>V</th>
            <th>I</th>
          </tr>
        </thead>
        <tbody>
          {t.lignes.map((l) => (
            <tr key={l.id}>
              <td className="c libelle">{l.phase}</td>
              <td className="c">{formatPhaseur(l.injecteV, "V")}</td>
              <td className="c">{formatPhaseur(l.injecteI, "A")}</td>
              <td className="c">{formatPhaseur(l.mesureV, "V")}</td>
              <td className="c">{formatPhaseur(l.mesureI, "A")}</td>
              <JugementTd valeur={l.jugement} />
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note">
        (*) Valeurs injectées sur les boîtiers d'essais. (**) Valeurs lues sur le relais.
        <br />
        <span className="en">
          (*) Secondary injection values through ESSAILEC sockets. (**) Values read on the relay.
        </span>
      </p>
    </div>
  );
}

/** Section 9 : caractéristiques TP / TC / tores, champ tournant, sens de câblage, injections, défaut terre. */
export function SectionCircuitsMesure({ d }: { d: PvRelaisData }) {
  const cm = d.circuitsMesure;
  return (
    <>
      <T1 id="mesures" sautAvant />
      <table className="t insecable">
        <colgroup>
          <col style={{ width: "30%" }} />
          <col style={{ width: "17%" }} />
          <col style={{ width: "11%" }} />
          <col style={{ width: "11%" }} />
          <col style={{ width: "20%" }} />
          <col style={{ width: "11%" }} />
        </colgroup>
        <thead>
          <tr>
            <th>
              <Bi fr="Caractéristiques" en="Characteristics" />
            </th>
            <th>
              <Bi fr="Rapport" en="Ratio" />
            </th>
            <th>
              <Bi fr="Classe" en="Class" />
            </th>
            <th>
              <Bi fr="Puissance" en="Burden" />
            </th>
            <th>
              <Bi fr="Remarques" en="Remarks" />
            </th>
            <th>Concl.</th>
          </tr>
        </thead>
        <tbody>
          {cm.transformateurs.map((t) => (
            <tr key={t.id}>
              <td>
                <span className="libelle">{t.libelleFr}</span>
                <br />
                <span className="en">{t.libelleEn}</span>
              </td>
              <td className="c">{t.rapport}</td>
              <td className="c">{t.classe}</td>
              <td className="c">{t.puissance}</td>
              <td>{t.remarques}</td>
              <JugementTd valeur={t.jugement} />
            </tr>
          ))}
        </tbody>
      </table>

      <table className="t insecable">
        <colgroup>
          <col style={{ width: "45%" }} />
          <col style={{ width: "44%" }} />
          <col style={{ width: "11%" }} />
        </colgroup>
        <tbody>
          <tr>
            <td className="libelle">
              Champ tournant / <span className="en">Phase rotation</span>
            </td>
            <td className="c">{cm.champTournant.valeur}</td>
            <JugementTd valeur={cm.champTournant.jugement} />
          </tr>
          {cm.sensCablage.map((s) => (
            <tr key={s.id}>
              <td>
                <span className="libelle">{s.libelleFr}</span>
                <br />
                <span className="en">{s.libelleEn}</span>
              </td>
              <td>{s.detail}</td>
              <JugementTd valeur={s.jugement} />
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note">
        Nota : sens P1 côté barre et P2 côté câble. S1 et S2 conformément au schéma constructeur du relais.
        <br />
        <span className="en">
          P1 facing busbar &amp; P2 cables side. S1 &amp; S2 conform to the electrical installation schematic of the
          manufacturer of the relay.
        </span>
      </p>

      <Titre2 id="s-9-1" numero="9.1">
        <Bi fr={cm.systemeEquilibre.titreFr} en={cm.systemeEquilibre.titreEn} />
      </Titre2>
      <TableauInjectionVue t={cm.systemeEquilibre} />
      <Titre2 id="s-9-2" numero="9.2">
        <Bi fr={cm.systemeDesequilibre.titreFr} en={cm.systemeDesequilibre.titreEn} />
      </Titre2>
      <TableauInjectionVue t={cm.systemeDesequilibre} />

      <Titre2 id="s-9-3" numero="9.3">
        <Bi fr="Circuits défaut terre" en="Earth fault circuit" />
      </Titre2>
      <table className="t insecable">
        <colgroup>
          <col style={{ width: "10%" }} />
          <col style={{ width: "19.5%" }} />
          <col style={{ width: "19.5%" }} />
          <col style={{ width: "19.5%" }} />
          <col style={{ width: "19.5%" }} />
          <col style={{ width: "12%" }} />
        </colgroup>
        <thead>
          <tr>
            <th rowSpan={2}>Tore</th>
            <th colSpan={2}>
              <Bi fr="Injection primaire (côté primaire tore)" en="Primary injection through CT" />
            </th>
            <th colSpan={2}>
              <Bi fr="Injection secondaire (boîtier ESSAILEC)" en="Secondary injection through ESSAILEC" />
            </th>
            <th rowSpan={2}>Concl.</th>
          </tr>
          <tr>
            <th>
              <Bi fr="Valeur injectée" en="Injected" />
            </th>
            <th>
              <Bi fr="Valeur mesurée (*)" en="Measured (*)" />
            </th>
            <th>
              <Bi fr="Valeur injectée" en="Injected" />
            </th>
            <th>
              <Bi fr="Valeur mesurée (*)" en="Measured (*)" />
            </th>
          </tr>
        </thead>
        <tbody>
          {cm.defautTerre.map((t) => (
            <tr key={t.id}>
              <td className="c libelle">{t.tore}</td>
              <td className="c">{t.primaireApplicable ? formatPhaseur(t.primaireInjecte, t.unite) : "N.A"}</td>
              <td className="c">{t.primaireApplicable ? formatPhaseur(t.primaireMesure, t.unite) : "N.A"}</td>
              <td className="c">{t.secondaireApplicable ? formatPhaseur(t.secondaireInjecte, t.unite) : "N.A"}</td>
              <td className="c">{t.secondaireApplicable ? formatPhaseur(t.secondaireMesure, t.unite) : "N.A"}</td>
              <JugementTd valeur={t.jugement} />
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note">
        (*) Valeurs du courant de terre lues sur le relais.{" "}
        <span className="en">Earth fault current values read on the protection relay.</span>
      </p>
      <h3>
        Schéma type d'installation / <span className="en">Typical installation schematic</span>
      </h3>
      <div className="schema">
        <img src={SCHEMA_TORE} alt="Schéma type d'installation du tore homopolaire" />
      </div>
      <table className="t insecable">
        <tbody>
          <tr>
            <td style={{ width: "89%" }}>
              <span className="libelle">{cm.controleTresse.libelleFr}</span>
              <br />
              <span className="en">{cm.controleTresse.libelleEn}</span>
              {cm.controleTresse.detail && <div className="note">{cm.controleTresse.detail}</div>}
            </td>
            <JugementTd valeur={cm.controleTresse.jugement} />
          </tr>
        </tbody>
      </table>
    </>
  );
}

const COLONNES_ES = 9;

function LigneEs({ p }: { p: PointEsPv }) {
  return (
    <tr className={p.reserve ? "reserve" : undefined}>
      <td className="c">{p.adresse}</td>
      <td className="c">{TYPE_ES_COURTS[p.type]}</td>
      <td>
        {p.designation}
        {p.reserve && <span className="tag-reserve">RÉSERVE</span>}
        {p.tag && p.tag !== "-" && <div className="note">{p.tag}</div>}
      </td>
      <JugementTd valeur={p.teste} />
      <JugementTd valeur={p.leds} />
      <JugementTd valeur={p.relais} />
      <JugementTd valeur={p.scada} />
      <td>{p.message}</td>
      <td>{p.commentaire}</td>
    </tr>
  );
}

/** Section 10 : cartes E/S et remontée SCADA (regroupées par carte), affectation des LED. */
export function SectionEs({
  d,
  avancement,
  groupes,
}: {
  d: PvRelaisData;
  avancement: AvancementEs;
  groupes: { carte: string; points: PointEsPv[] }[];
}) {
  const moitie = Math.ceil(d.leds.length / 2);
  const gauche = d.leds.slice(0, moitie);
  const droite = d.leds.slice(moitie);
  return (
    <>
      <T1 id="es" sautAvant />
      <Titre2 id="s-10-1" numero="10.1">
        <Bi fr="Cartes E/S et remontée SCADA" en="I/O cards and SCADA check" />
      </Titre2>
      {d.es.referenceDocument && (
        <p className="note">
          Liste E/S : <strong>{d.es.referenceDocument}</strong>
          {d.es.revision && <> rév. {d.es.revision}</>}
          {d.es.listeVersion !== null && <> (version {d.es.listeVersion})</>}
          {d.es.feuille && <> — feuille « {d.es.feuille} »</>}
          {d.es.filtreTag && <> — partie « {d.es.filtreTag} »</>}
        </p>
      )}
      <p className="avancement">
        E/S testées / tested : {avancement.testees} / {avancement.total} — NC : {avancement.nc} — réserves / spare :{" "}
        {avancement.reserves}
      </p>
      {d.es.points.length === 0 ? (
        <p className="vide">Aucune entrée/sortie pour cet équipement.</p>
      ) : (
        <table className="t es">
          <colgroup>
            <col style={{ width: "8%" }} />
            <col style={{ width: "6%" }} />
            <col style={{ width: "25%" }} />
            <col style={{ width: "6%" }} />
            <col style={{ width: "5.5%" }} />
            <col style={{ width: "5.5%" }} />
            <col style={{ width: "6%" }} />
            <col style={{ width: "20%" }} />
            <col style={{ width: "18%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>
                Adresse
                <br />
                <span className="en">Address</span>
              </th>
              <th>Type</th>
              <th>
                Désignation
                <br />
                <span className="en">Designation</span>
              </th>
              <th>
                Testé validé
                <br />
                <span className="en">Tested</span>
              </th>
              <th>
                LED
                <br />
                <span className="en">LEDs</span>
              </th>
              <th>
                Relais
                <br />
                <span className="en">Relays</span>
              </th>
              <th>SCADA</th>
              <th>
                Message lu en supervision
                <br />
                <span className="en">SCADA message</span>
              </th>
              <th>
                Commentaire
                <br />
                <span className="en">Comment</span>
              </th>
            </tr>
          </thead>
          {groupes.map((g) => (
            <tbody key={g.carte}>
              <tr className="groupe">
                <th colSpan={COLONNES_ES}>Carte / Card : {g.carte || "—"}</th>
              </tr>
              {g.points.map((p) => (
                <LigneEs key={p.id} p={p} />
              ))}
            </tbody>
          ))}
        </table>
      )}

      <Titre2 id="s-10-2" numero="10.2">
        <Bi fr="AFFECTATION LED" en="LED ASSIGNMENT" />
      </Titre2>
      {d.leds.length === 0 ? (
        <p className="vide">Aucune LED affectée.</p>
      ) : (
        <table className="t leds">
          <colgroup>
            <col style={{ width: "8%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "25%" }} />
            <col style={{ width: "6%" }} />
            <col style={{ width: "4%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "25%" }} />
            <col style={{ width: "6%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>N°</th>
              <th>Couleur</th>
              <th>Désignation</th>
              <th>Vérif.</th>
              <th className="sep" />
              <th>N°</th>
              <th>Couleur</th>
              <th>Désignation</th>
              <th>Vérif.</th>
            </tr>
          </thead>
          <tbody>
            {gauche.map((l, i) => {
              const r = droite[i];
              return (
                <tr key={l.id}>
                  <td>{l.numero}</td>
                  <td>{l.couleur}</td>
                  <td>{l.designation}</td>
                  <JugementTd valeur={l.jugement} />
                  <td className="sep" />
                  <td>{r?.numero}</td>
                  <td>{r?.couleur}</td>
                  <td>{r?.designation}</td>
                  <JugementTd valeur={r?.jugement ?? null} />
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}

function BlocFonction({ f }: { f: FonctionProtection }) {
  const groupes = f.injections;
  const nbLignes = Math.max(1, ...groupes.map((g) => g.lignes.length), f.tempsMesures.length);
  return (
    <div className="fonction">
      <table className="t">
        <colgroup>
          <col style={{ width: "12%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "27%" }} />
          <col style={{ width: "15%" }} />
          <col style={{ width: "15%" }} />
          <col style={{ width: "15%" }} />
        </colgroup>
        <tbody>
          <tr>
            <td colSpan={2} className="nom-logique">
              {f.nomLogique}
            </td>
            <td colSpan={5} className="titre-fonction">
              <Bi fr={f.libelleFr} en={f.libelleEn} />
            </td>
          </tr>
          <tr>
            <th>Code ANSI</th>
            <th>Ex</th>
            <th>Gr.P</th>
            <th>Réglages / Settings</th>
            <th>Fonction</th>
            <th>Courbe / Curve</th>
            <th>Temps / Time</th>
          </tr>
          <tr>
            <td className="c">{f.codeAnsi}</td>
            <td className="c">{f.ex}</td>
            <td className="c">{f.grP}</td>
            <td className="c">{f.reglages}</td>
            <td className="c">{f.fonction}</td>
            <td className="c">{f.courbe}</td>
            <td className="c">{f.temps}</td>
          </tr>
        </tbody>
      </table>
      <table className="t">
        <tbody>
          <tr>
            {groupes.map((g) => (
              <th key={g.id} colSpan={3} rowSpan={2}>
                <Bi fr={g.titreFr} en={g.titreEn} />
              </th>
            ))}
            <th colSpan={3}>
              <Bi fr="Temps mesuré" en="Measured time" />
            </th>
          </tr>
          <tr>
            <th>Protection</th>
            <th>Alarme</th>
            <th>Déclench.</th>
          </tr>
          {Array.from({ length: nbLignes }, (_, i) => {
            const t = f.tempsMesures[i];
            return (
              <tr key={i}>
                {groupes.map((g) => {
                  const l = g.lignes[i];
                  return [
                    <td key={`${g.id}-l`} className="lib-ligne">
                      {l ? `${l.libelle} :` : ""}
                    </td>,
                    <td key={`${g.id}-a`} className="c">
                      {l && l.amplitude !== null ? `${formatNombre(l.amplitude)} ${l.unite}` : ""}
                    </td>,
                    <td key={`${g.id}-g`} className="c">
                      {l ? formatAngle(l.angle) : ""}
                    </td>,
                  ];
                })}
                <td className="c">{t?.protection}</td>
                <td className="c">{t?.alarme}</td>
                <td className="c">{t?.declenchement}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <table className="t">
        <colgroup>
          <col style={{ width: "16%" }} />
          <col style={{ width: "42%" }} />
          <col style={{ width: "42%" }} />
        </colgroup>
        <tbody>
          <tr>
            <th />
            <th>
              <Bi fr="LED activées" en="Activated LEDs" />
            </th>
            <th>
              <Bi fr={"Sorties activées (« NE » pour normalement excité)"} en="Outputs" />
            </th>
          </tr>
          <tr>
            <th className="entete-ligne">Attendu / Expected</th>
            <td>{f.leds.attendu}</td>
            <td>{f.sorties.attendu}</td>
          </tr>
          <tr>
            <th className="entete-ligne">Constaté / Observed</th>
            <td>{f.leds.constate}</td>
            <td>{f.sorties.constate}</td>
          </tr>
          <tr>
            <th />
            <th>
              <Bi fr="Messages (IHM / Supervision)" en="Messages (HMI / SCADA)" />
            </th>
            <th>
              <Bi fr="Commentaires" en="Comments" />
            </th>
          </tr>
          <tr>
            <th className="entete-ligne">Attendu / Expected</th>
            <td>{f.messages.attendu}</td>
            <td rowSpan={2}>{f.commentaires}</td>
          </tr>
          <tr>
            <th className="entete-ligne">Constaté / Observed</th>
            <td>{f.messages.constate}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** Section 11 : plan de protection, un bloc insécable par fonction. */
export function SectionProtection({ d }: { d: PvRelaisData }) {
  return (
    <>
      <T1 id="protection" sautAvant />
      {d.fonctions.length === 0 ? (
        <p className="vide">Aucune fonction de protection renseignée.</p>
      ) : (
        d.fonctions.map((f) => <BlocFonction key={f.id} f={f} />)
      )}
    </>
  );
}

const marque = (b: boolean) => (b ? "X" : "");

/** Section 12 : observations, réserves et récapitulatif. */
export function SectionObservations({ d, recap }: { d: PvRelaisData; recap: { ouvertes: number; levees: number } }) {
  return (
    <>
      <T1 id="observations" sautAvant />
      <table className="t">
        <colgroup>
          <col style={{ width: "6%" }} />
          <col style={{ width: "30%" }} />
          <col style={{ width: "6%" }} />
          <col style={{ width: "6%" }} />
          <col style={{ width: "6%" }} />
          <col style={{ width: "7%" }} />
          <col style={{ width: "39%" }} />
        </colgroup>
        <thead>
          <tr>
            <th rowSpan={2}>N°</th>
            <th rowSpan={2}>
              <Bi fr="Libellé du contrôle" en="Test name" />
            </th>
            <th rowSpan={2}>NA</th>
            <th colSpan={2}>Conforme</th>
            <th colSpan={2}>
              <Bi fr="Réserve" en="Suspend" />
            </th>
          </tr>
          <tr>
            <th>C</th>
            <th>NC</th>
            <th>N°</th>
            <th>Observations</th>
          </tr>
        </thead>
        <tbody>
          {d.observations.length === 0 ? (
            <tr>
              <td colSpan={7} className="vide c">
                Aucune observation / No comment
              </td>
            </tr>
          ) : (
            d.observations.map((o) => (
              <tr key={o.id}>
                <td className="c">{o.numero}</td>
                <td>{o.libelle}</td>
                <td className="j">{marque(o.jugement === "NA")}</td>
                <td className="j">{marque(o.jugement === "C")}</td>
                <td className="j nc">{marque(o.jugement === "NC")}</td>
                <td className="c">{o.reserveNumero ?? ""}</td>
                <td>{o.observation}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <Titre2 id="s-12-1" numero="12.1">
        <Bi fr="RÉSERVES" en="SUSPEND ITEMS" />
      </Titre2>
      <p className="recap">
        Réserves ouvertes / open : {recap.ouvertes} — levées / lifted : {recap.levees}
      </p>
      {d.reserves.length > 0 && (
        <table className="t">
          <colgroup>
            <col style={{ width: "6%" }} />
            <col style={{ width: "22%" }} />
            <col style={{ width: "28%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "11%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>N°</th>
              <th>
                <Bi fr="Contrôle concerné" en="Related check" />
              </th>
              <th>Description</th>
              <th>
                <Bi fr="Criticité" en="Criticality" />
              </th>
              <th>
                <Bi fr="Responsable levée" en="Owner" />
              </th>
              <th>
                <Bi fr="Levée prévue" en="Due" />
              </th>
              <th>
                <Bi fr="Statut" en="Status" />
              </th>
            </tr>
          </thead>
          <tbody>
            {d.reserves.map((r) => (
              <tr key={r.id}>
                <td className="c">{r.numero}</td>
                <td>{r.controle}</td>
                <td>{r.description}</td>
                <td className="c">{r.criticite ? CRITICITE_LABELS[r.criticite] : ""}</td>
                <td>{r.responsable}</td>
                <td className="c">{formatDate(r.datePrevue)}</td>
                <td className="c">
                  {r.statut === "ouverte" ? "Ouverte / Open" : "Levée / Lifted"}
                  {r.levee && (
                    <div className="note">
                      {formatDate(r.levee.date)} (ind. {r.levee.indice}) {r.levee.commentaire}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

/** Section 13 : conclusion générale (matériel accepté / refusé) et signatures. */
export function SectionConclusion({ d, libelles }: { d: PvRelaisData; libelles: Record<Conclusion, string> }) {
  const { spie, client } = d.signatures;
  return (
    <>
      <T1 id="conclusion" sautAvant />
      <div className="conclusion-materiel" title={d.conclusion.materiel ? libelles[d.conclusion.materiel] : undefined}>
        - MATÉRIEL / MATERIAL :
        <Case coche={d.conclusion.materiel === "accepte"} />
        Accepté / Accepted
        <Case coche={d.conclusion.materiel === "refuse"} />
        Refusé / Rejected
      </div>
      <table className="t signatures">
        <colgroup>
          <col style={{ width: "20%" }} />
          <col style={{ width: "40%" }} />
          <col style={{ width: "40%" }} />
        </colgroup>
        <thead>
          <tr>
            <th />
            <th>SPIE Industrie</th>
            <th>CLIENT / CUSTOMER</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th className="entete-ligne">DATE</th>
            <td className="c">{formatDate(spie.date)}</td>
            <td className="c">{formatDate(client.date)}</td>
          </tr>
          <tr>
            <th className="entete-ligne">NOM / NAME</th>
            <td className="c">{spie.nom}</td>
            <td className="c">{client.nom}</td>
          </tr>
          <tr>
            <th className="entete-ligne">VISA / SIGNATURE</th>
            <td className="visa">{spie.signature && <img src={spie.signature} alt="Signature SPIE" />}</td>
            <td className="visa">
              {client.refus ? (
                <div className="refus">
                  Refus de signer / Refused to sign
                  {client.refus.motif && <div className="note">Motif / Reason : {client.refus.motif}</div>}
                </div>
              ) : (
                client.signature && <img src={client.signature} alt="Signature client" />
              )}
            </td>
          </tr>
          <tr>
            <th className="entete-ligne">COMMENTAIRES / COMMENTS</th>
            <td className="commentaires">{spie.commentaires}</td>
            <td className="commentaires">{client.commentaires}</td>
          </tr>
        </tbody>
      </table>
    </>
  );
}

/** Annexe facultative : valeurs pré-remplies modifiées sur site (point ouvert n°8). */
export function SectionModifications({ modifications }: { modifications: ModificationTracee[] }) {
  return (
    <>
      <h1 id="s-annexe" className="saut-avant">
        <span className="num">A.</span>VALEURS PRÉ-REMPLIES MODIFIÉES SUR SITE / PRE-FILLED VALUES CHANGED ON SITE
      </h1>
      <table className="t modifs">
        <colgroup>
          <col style={{ width: "28%" }} />
          <col style={{ width: "22%" }} />
          <col style={{ width: "22%" }} />
          <col style={{ width: "28%" }} />
        </colgroup>
        <thead>
          <tr>
            <th>
              <Bi fr="Champ" en="Field" />
            </th>
            <th>
              <Bi fr="Valeur préparée" en="Prepared" />
            </th>
            <th>
              <Bi fr="Valeur sur site" en="On site" />
            </th>
            <th>
              <Bi fr="Par, le" en="By, on" />
            </th>
          </tr>
        </thead>
        <tbody>
          {modifications.map((m) => (
            <tr key={m.chemin}>
              <td className="chemin">{m.chemin}</td>
              <td>{formatValeur(m.avant)}</td>
              <td>{m.apres === null ? "(supprimé)" : formatValeur(m.apres)}</td>
              <td>
                {m.par}, {formatDateHeure(m.le)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
