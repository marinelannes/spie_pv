import type { LigneInjection, LigneTore, PvRelaisData, TableauInjection, Transformateur } from "@spie/shared";
import { majItem, useEditeur } from "../context";
import { Bloc, CelluleTexte, ChampPhaseur, JugementBoutons, MarqueCorrige } from "../fields";
import { NcPanel } from "../NcPanel";

/** Section 9 : vérification des circuits de mesures (TP / TC, sens de câblage, injections, défaut terre). */

type CircuitsMesure = PvRelaisData["circuitsMesure"];

/** Libellé visible au-dessus d'une cellule de saisie (le nom complet reste dans aria-label). */
const libelleCellule = "mb-1 block text-sm font-semibold text-slate-600";
const enteteColonne = "hidden text-sm font-semibold uppercase text-slate-600 sm:block";

function useCircuits() {
  const e = useEditeur();
  const set = (fn: (c: CircuitsMesure) => CircuitsMesure) =>
    e.maj((x) => ({ ...x, circuitsMesure: fn(x.circuitsMesure) }));
  return { ...e, c: e.donnees.circuitsMesure, pc: e.preparees?.circuitsMesure, set };
}

function LigneTransformateur({ t }: { t: Transformateur }) {
  const { set, site, pc } = useCircuits();
  const prep = pc?.transformateurs.find((x) => x.id === t.id);
  const patch = (p: Partial<Transformateur>) =>
    set((c) => ({ ...c, transformateurs: majItem(c.transformateurs, t.id, p) }));
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <p className="font-semibold">
        {t.libelleFr} <span className="font-normal text-slate-600">/ {t.libelleEn}</span>
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-4">
        <div>
          <span className={libelleCellule}>Rapport</span>
          <CelluleTexte
            label={`${t.libelleFr} — rapport`}
            placeholder="ex. 20000/100 V"
            valeur={t.rapport}
            onChange={(rapport) => patch({ rapport })}
          />
          <MarqueCorrige prepare={prep?.rapport} actuel={t.rapport} />
        </div>
        <div>
          <span className={libelleCellule}>Classe</span>
          <CelluleTexte
            label={`${t.libelleFr} — classe`}
            placeholder="ex. 0,5 / 5P20"
            valeur={t.classe}
            onChange={(classe) => patch({ classe })}
          />
          <MarqueCorrige prepare={prep?.classe} actuel={t.classe} />
        </div>
        <div>
          <span className={libelleCellule}>Puissance</span>
          <CelluleTexte
            label={`${t.libelleFr} — puissance`}
            placeholder="ex. 15 VA"
            valeur={t.puissance}
            onChange={(puissance) => patch({ puissance })}
          />
          <MarqueCorrige prepare={prep?.puissance} actuel={t.puissance} />
        </div>
        <div>
          <span className={libelleCellule}>Remarques</span>
          <CelluleTexte
            label={`${t.libelleFr} — remarques`}
            valeur={t.remarques}
            onChange={(remarques) => patch({ remarques })}
          />
        </div>
      </div>
      <p className="mt-1 text-sm text-slate-600">« NA » si non applicable.</p>
      {site && (
        <div className="mt-2">
          <JugementBoutons
            label={`Vérification : ${t.libelleFr}`}
            valeur={t.jugement}
            onChange={(jugement) => patch({ jugement })}
          />
        </div>
      )}
      {t.jugement === "NC" && <NcPanel refControle={`transfo.${t.id}`} libelle={t.libelleFr} />}
    </div>
  );
}

function TableInjection({ tab, cle }: { tab: TableauInjection; cle: "systemeEquilibre" | "systemeDesequilibre" }) {
  const { set, site, pc } = useCircuits();
  const prep = pc?.[cle];
  const patch = (id: string, p: Partial<LigneInjection>) =>
    set((c) => ({ ...c, [cle]: { ...c[cle], lignes: majItem(c[cle].lignes, id, p) } }));
  return (
    <Bloc
      titre={`${tab.titreFr} / ${tab.titreEn}`}
      sousTitre="Injections secondaires U et I sur boîtiers ESSAILEC : valeurs injectées (*) → valeurs lues sur le relais (**)."
    >
      {tab.lignes.map((l) => {
        const lp = prep?.lignes.find((x) => x.id === l.id);
        return (
          <div key={l.id} className="rounded-lg border border-slate-200 p-3">
            <p className="mb-2 text-lg font-bold">Phase {l.phase}</p>
            {/* Tableau compact : une ligne « injecté », une ligne « mesuré » ; tension et courant en colonnes. */}
            <div className="grid items-start gap-x-4 gap-y-2 sm:grid-cols-[9rem_1fr_1fr]">
              <span className={enteteColonne} />
              <span className={enteteColonne}>Tension (V, °)</span>
              <span className={enteteColonne}>Courant (A, °)</span>
              <span className="pt-3 text-sm font-semibold uppercase text-slate-600">Injecté (*)</span>
              <div>
                <ChampPhaseur
                  label={`${tab.titreFr} phase ${l.phase} — V injectée`}
                  unite="V"
                  valeur={l.injecteV}
                  onChange={(injecteV) => patch(l.id, { injecteV })}
                />
                <MarqueCorrige
                  prepare={lp && lp.injecteV.amplitude !== null ? lp.injecteV : undefined}
                  actuel={l.injecteV}
                />
              </div>
              <div>
                <ChampPhaseur
                  label={`${tab.titreFr} phase ${l.phase} — I injecté`}
                  unite="A"
                  valeur={l.injecteI}
                  onChange={(injecteI) => patch(l.id, { injecteI })}
                />
                <MarqueCorrige
                  prepare={lp && lp.injecteI.amplitude !== null ? lp.injecteI : undefined}
                  actuel={l.injecteI}
                />
              </div>
              {site && (
                <>
                  <span className="pt-3 text-sm font-semibold uppercase text-slate-600">Mesuré (**)</span>
                  <ChampPhaseur
                    label={`${tab.titreFr} phase ${l.phase} — V mesurée`}
                    unite="V"
                    valeur={l.mesureV}
                    onChange={(mesureV) => patch(l.id, { mesureV })}
                  />
                  <ChampPhaseur
                    label={`${tab.titreFr} phase ${l.phase} — I mesuré`}
                    unite="A"
                    valeur={l.mesureI}
                    onChange={(mesureI) => patch(l.id, { mesureI })}
                  />
                </>
              )}
            </div>
            {site && (
              <div className="mt-2 flex items-center gap-3">
                <span className="font-medium">Conclusion</span>
                <JugementBoutons
                  label={`Conclusion ${tab.titreFr} phase ${l.phase}`}
                  valeur={l.jugement}
                  onChange={(jugement) => patch(l.id, { jugement })}
                />
              </div>
            )}
            {l.jugement === "NC" && (
              <NcPanel refControle={`injection.${tab.id}.${l.id}`} libelle={`${tab.titreFr} — phase ${l.phase}`} />
            )}
          </div>
        );
      })}
    </Bloc>
  );
}

function LigneDefautTerre({ t }: { t: LigneTore }) {
  const { set, site, lectureSeule } = useCircuits();
  const patch = (p: Partial<LigneTore>) => set((c) => ({ ...c, defautTerre: majItem(c.defautTerre, t.id, p) }));
  const caseA = (label: string, checked: boolean, onChange: (v: boolean) => void) => (
    <label className="inline-flex min-h-12 items-center gap-2">
      <input
        type="checkbox"
        className="size-6"
        checked={checked}
        disabled={lectureSeule}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <p className="mb-2 text-lg font-bold">
        Tore {t.tore} ({t.unite})
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          {caseA("Injection primaire (côté primaire tore)", t.primaireApplicable, (primaireApplicable) =>
            patch({ primaireApplicable }),
          )}
          {t.primaireApplicable ? (
            <>
              <ChampPhaseur
                label={`Tore ${t.tore} — primaire injecté`}
                unite={t.unite}
                valeur={t.primaireInjecte}
                onChange={(primaireInjecte) => patch({ primaireInjecte })}
              />
              {site && (
                <ChampPhaseur
                  label={`Tore ${t.tore} — primaire mesuré`}
                  unite={t.unite}
                  valeur={t.primaireMesure}
                  onChange={(primaireMesure) => patch({ primaireMesure })}
                />
              )}
            </>
          ) : (
            <p className="text-slate-600">N.A</p>
          )}
        </div>
        <div className="space-y-2">
          {caseA("Injection secondaire (boîtier ESSAILEC)", t.secondaireApplicable, (secondaireApplicable) =>
            patch({ secondaireApplicable }),
          )}
          {t.secondaireApplicable ? (
            <>
              <ChampPhaseur
                label={`Tore ${t.tore} — secondaire injecté`}
                unite={t.unite}
                valeur={t.secondaireInjecte}
                onChange={(secondaireInjecte) => patch({ secondaireInjecte })}
              />
              {site && (
                <ChampPhaseur
                  label={`Tore ${t.tore} — secondaire mesuré`}
                  unite={t.unite}
                  valeur={t.secondaireMesure}
                  onChange={(secondaireMesure) => patch({ secondaireMesure })}
                />
              )}
            </>
          ) : (
            <p className="text-slate-600">N.A</p>
          )}
        </div>
      </div>
      {site && (
        <div className="mt-2">
          <JugementBoutons
            label={`Conclusion tore ${t.tore}`}
            valeur={t.jugement}
            onChange={(jugement) => patch({ jugement })}
          />
        </div>
      )}
      {t.jugement === "NC" && (
        <NcPanel refControle={`tore.${t.id}`} libelle={`Circuit défaut terre — tore ${t.tore}`} />
      )}
    </div>
  );
}

export function SectionMesures() {
  const { c, set, site } = useCircuits();
  return (
    <div className="space-y-5">
      <Bloc titre="Caractéristiques TP / TC et tores" sousTitre="Préparées au bureau, vérifiées C / NC / NA sur site.">
        {c.transformateurs.map((t) => (
          <LigneTransformateur key={t.id} t={t} />
        ))}
        <div className="rounded-lg border border-slate-200 p-3">
          <p className="font-semibold">Champ tournant / Phase rotation</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <CelluleTexte
              className="w-56"
              label="Champ tournant"
              valeur={c.champTournant.valeur}
              onChange={(valeur) => set((x) => ({ ...x, champTournant: { ...x.champTournant, valeur } }))}
            />
            {site && (
              <JugementBoutons
                label="Vérification du champ tournant"
                valeur={c.champTournant.jugement}
                onChange={(jugement) => set((x) => ({ ...x, champTournant: { ...x.champTournant, jugement } }))}
              />
            )}
          </div>
          {c.champTournant.jugement === "NC" && <NcPanel refControle="champ-tournant" libelle="Champ tournant" />}
        </div>
      </Bloc>
      <Bloc
        titre="Vérification du sens de câblage"
        sousTitre="Nota : sens P1 côté barre et P2 côté câble. S1 et S2 conformément au schéma constructeur du relais."
      >
        {c.sensCablage.map((s) => (
          <div key={s.id} className="rounded-lg border border-slate-200 p-3">
            <p className="font-semibold">{s.libelleFr}</p>
            <p className="text-slate-600">{s.detail}</p>
            {site && (
              <div className="mt-2">
                <JugementBoutons
                  label={`Vérification : ${s.libelleFr}`}
                  valeur={s.jugement}
                  onChange={(jugement) =>
                    set((x) => ({ ...x, sensCablage: majItem(x.sensCablage, s.id, { jugement }) }))
                  }
                />
              </div>
            )}
            {s.jugement === "NC" && <NcPanel refControle={`sens.${s.id}`} libelle={s.libelleFr} />}
          </div>
        ))}
      </Bloc>
      <TableInjection tab={c.systemeEquilibre} cle="systemeEquilibre" />
      <TableInjection tab={c.systemeDesequilibre} cle="systemeDesequilibre" />
      <Bloc
        titre="Circuits défaut terre / Earth fault circuit"
        sousTitre="Valeurs du courant de terre lues sur le relais."
      >
        {c.defautTerre.map((t) => (
          <LigneDefautTerre key={t.id} t={t} />
        ))}
        <div className="rounded-lg border border-slate-200 p-3">
          <p className="font-semibold">{c.controleTresse.libelleFr}</p>
          <p className="text-slate-600">{c.controleTresse.libelleEn}</p>
          {site && (
            <div className="mt-2">
              <JugementBoutons
                label="Contrôle câblage tresse de terre"
                valeur={c.controleTresse.jugement}
                onChange={(jugement) => set((x) => ({ ...x, controleTresse: { ...x.controleTresse, jugement } }))}
              />
            </div>
          )}
          {c.controleTresse.jugement === "NC" && <NcPanel refControle="tresse" libelle={c.controleTresse.libelleFr} />}
        </div>
      </Bloc>
    </div>
  );
}
