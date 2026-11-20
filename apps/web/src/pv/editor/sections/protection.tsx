import { nouvelId, nouvelleFonction, type FonctionProtection, type GroupeInjection } from "@spie/shared";
import { deplacerItem, majItem, retirerItem, useEditeur } from "../context";
import { Bloc, BoutonPetit, CelluleTexte, ChampNombre, ChampTexte } from "../fields";

/** Section 11 : plan de protection, un bloc par fonction (spec §4.2). Pas de conclusion par fonction. */

/** Copie d'une fonction avec de nouveaux identifiants (duplication d'un bloc au bureau). */
export function copierFonction(f: FonctionProtection, idFn: () => string = nouvelId): FonctionProtection {
  return {
    ...structuredClone(f),
    id: idFn(),
    injections: f.injections.map((g) => ({ ...g, id: idFn(), lignes: g.lignes.map((l) => ({ ...l, id: idFn() })) })),
    tempsMesures: f.tempsMesures.map((t) => ({ ...t, id: idFn(), protection: "", alarme: "", declenchement: "" })),
    leds: { ...f.leds, constate: "" },
    sorties: { ...f.sorties, constate: "" },
    messages: { ...f.messages, constate: "" },
  };
}

/**
 * Nom accessible d'un champ d'injection : « PHPTOC1 — Injection 1 — Ia — amplitude ». Les parties vides sont
 * omises (pas d'espace en tête ni de double espace quand le nom logique ou le libellé ne sont pas encore saisis).
 */
export function libelleInjection(
  f: Pick<FonctionProtection, "nomLogique" | "libelleFr">,
  g: Pick<GroupeInjection, "titreFr">,
  l: { libelle: string },
  index: number,
  champ: string,
): string {
  const fonction = f.nomLogique.trim() || f.libelleFr.trim() || "Fonction";
  const ligne = l.libelle.trim() || `ligne ${index + 1}`;
  return [fonction, g.titreFr.trim(), ligne, champ].filter(Boolean).join(" — ");
}

function GroupeInjections({
  f,
  g,
  onChange,
}: {
  f: FonctionProtection;
  g: GroupeInjection;
  onChange: (g: GroupeInjection) => void;
}) {
  return (
    <div className="space-y-2 rounded-lg bg-slate-50 p-3">
      <p className="font-semibold">
        {g.titreFr} / {g.titreEn}
      </p>
      {g.lignes.map((l, i) => (
        <div key={l.id} className="flex flex-wrap items-center gap-2">
          <CelluleTexte
            className="w-24"
            label={libelleInjection(f, g, l, i, "libellé")}
            valeur={l.libelle}
            onChange={(libelle) => onChange({ ...g, lignes: majItem(g.lignes, l.id, { libelle }) })}
          />
          <ChampNombre
            label={libelleInjection(f, g, l, i, "amplitude")}
            valeur={l.amplitude}
            onChange={(amplitude) => onChange({ ...g, lignes: majItem(g.lignes, l.id, { amplitude }) })}
          />
          <CelluleTexte
            className="w-16"
            label={libelleInjection(f, g, l, i, "unité")}
            valeur={l.unite}
            onChange={(unite) => onChange({ ...g, lignes: majItem(g.lignes, l.id, { unite }) })}
          />
          <ChampNombre
            label={libelleInjection(f, g, l, i, "angle")}
            unite="°"
            valeur={l.angle}
            onChange={(angle) => onChange({ ...g, lignes: majItem(g.lignes, l.id, { angle }) })}
          />
        </div>
      ))}
    </div>
  );
}

function BlocFonction({ f, index, total }: { f: FonctionProtection; index: number; total: number }) {
  const { preparees, maj, site, lectureSeule } = useEditeur();
  const prep = preparees?.fonctions.find((x) => x.id === f.id);
  const patch = (p: Partial<FonctionProtection>) => maj((d) => ({ ...d, fonctions: majItem(d.fonctions, f.id, p) }));
  const nom = f.nomLogique || f.libelleFr || `Fonction ${index + 1}`;
  const reglage = (
    k: "codeAnsi" | "ex" | "grP" | "reglages" | "fonction" | "courbe" | "temps",
    label: string,
    w = "",
  ) => (
    <div className={w}>
      <ChampTexte label={label} valeur={f[k]} prepare={prep?.[k]} onChange={(v) => patch({ [k]: v })} />
    </div>
  );
  const attenduConstate = (k: "leds" | "sorties" | "messages", label: string) => (
    <div className="grid gap-2 sm:grid-cols-2">
      <div>
        <ChampTexte
          label={`${label} — attendu`}
          valeur={f[k].attendu}
          prepare={prep?.[k].attendu}
          onChange={(attendu) => patch({ [k]: { ...f[k], attendu } })}
        />
      </div>
      {site && (
        <ChampTexte
          label={`${label} — constaté`}
          valeur={f[k].constate}
          onChange={(constate) => patch({ [k]: { ...f[k], constate } })}
        />
      )}
    </div>
  );

  return (
    <Bloc
      titre={`${index + 1}. ${nom}`}
      sousTitre={[f.libelleFr, f.codeAnsi && `ANSI ${f.codeAnsi}`].filter(Boolean).join(" — ")}
      actions={
        !lectureSeule && (
          <div className="flex flex-wrap gap-2">
            <BoutonPetit
              label={`Monter ${nom}`}
              disabled={index === 0}
              onClick={() => maj((d) => ({ ...d, fonctions: deplacerItem(d.fonctions, f.id, -1) }))}
            >
              ↑
            </BoutonPetit>
            <BoutonPetit
              label={`Descendre ${nom}`}
              disabled={index === total - 1}
              onClick={() => maj((d) => ({ ...d, fonctions: deplacerItem(d.fonctions, f.id, 1) }))}
            >
              ↓
            </BoutonPetit>
            <BoutonPetit
              onClick={() =>
                maj((d) => {
                  const i = d.fonctions.findIndex((x) => x.id === f.id);
                  const copie = copierFonction(f);
                  return { ...d, fonctions: [...d.fonctions.slice(0, i + 1), copie, ...d.fonctions.slice(i + 1)] };
                })
              }
            >
              Dupliquer
            </BoutonPetit>
            <BoutonPetit
              danger
              onClick={() => {
                if (window.confirm(`Supprimer la fonction ${nom} ?`))
                  maj((d) => ({ ...d, fonctions: retirerItem(d.fonctions, f.id) }));
              }}
            >
              Supprimer
            </BoutonPetit>
          </div>
        )
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <ChampTexte
          label="Nom logique (ex. PHPTOC1)"
          valeur={f.nomLogique}
          prepare={prep?.nomLogique}
          onChange={(nomLogique) => patch({ nomLogique })}
        />
        <ChampTexte
          label="Libellé (français)"
          valeur={f.libelleFr}
          prepare={prep?.libelleFr}
          onChange={(libelleFr) => patch({ libelleFr })}
        />
        <ChampTexte
          label="Libellé (anglais)"
          valeur={f.libelleEn}
          prepare={prep?.libelleEn}
          onChange={(libelleEn) => patch({ libelleEn })}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {reglage("codeAnsi", "Code ANSI")}
        {reglage("ex", "Ex")}
        {reglage("grP", "Gr.P")}
        {reglage("reglages", "Réglages", "sm:col-span-2")}
        {reglage("courbe", "Courbe")}
        {reglage("temps", "Temps")}
        {reglage("fonction", "Fonction (facultatif)")}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {f.injections.map((g) => (
          <GroupeInjections
            key={g.id}
            f={f}
            g={g}
            onChange={(ng) => patch({ injections: majItem(f.injections, g.id, ng) })}
          />
        ))}
      </div>
      {site && (
        <div className="space-y-2">
          <p className="font-semibold">Temps mesurés / Measured time</p>
          {f.tempsMesures.map((t, i) => (
            <div key={t.id} className="grid gap-2 sm:grid-cols-[auto_1fr_1fr_1fr] sm:items-center">
              <span className="text-slate-600">Essai {i + 1}</span>
              {(["protection", "alarme", "declenchement"] as const).map((k) => (
                <CelluleTexte
                  key={k}
                  label={`${nom} essai ${i + 1} — ${{ protection: "protection", alarme: "alarme", declenchement: "déclenchement" }[k]}`}
                  valeur={t[k]}
                  onChange={(v) => patch({ tempsMesures: majItem(f.tempsMesures, t.id, { [k]: v }) })}
                />
              ))}
            </div>
          ))}
          {!lectureSeule && f.tempsMesures.length < 6 && (
            <BoutonPetit
              onClick={() =>
                patch({
                  tempsMesures: [...f.tempsMesures, { id: nouvelId(), protection: "", alarme: "", declenchement: "" }],
                })
              }
            >
              Ajouter un essai
            </BoutonPetit>
          )}
        </div>
      )}
      {attenduConstate("leds", "LED activées")}
      {attenduConstate("sorties", "Sorties activées (« NE » : normalement excité)")}
      {attenduConstate("messages", "Messages IHM / supervision")}
      <ChampTexte
        label="Commentaires"
        multiligne
        valeur={f.commentaires}
        prepare={prep?.commentaires}
        onChange={(commentaires) => patch({ commentaires })}
      />
      {prep === undefined && site && preparees && (
        <span className="inline-block rounded bg-amber-100 px-2 py-0.5 text-sm text-amber-900">
          Fonction ajoutée sur site
        </span>
      )}
    </Bloc>
  );
}

export function SectionProtection() {
  const { donnees, maj, lectureSeule } = useEditeur();
  return (
    <div className="space-y-5">
      {donnees.fonctions.length === 0 && (
        <p className="rounded-lg bg-slate-100 p-4 text-slate-700">
          Aucune fonction de protection. Ajoutez un bloc par fonction du plan de protection.
        </p>
      )}
      {donnees.fonctions.map((f, i) => (
        <BlocFonction key={f.id} f={f} index={i} total={donnees.fonctions.length} />
      ))}
      {!lectureSeule && (
        <BoutonPetit onClick={() => maj((d) => ({ ...d, fonctions: [...d.fonctions, nouvelleFonction()] }))}>
          Ajouter une fonction de protection
        </BoutonPetit>
      )}
    </div>
  );
}
