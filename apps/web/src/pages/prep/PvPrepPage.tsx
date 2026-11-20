import {
  libelleCheminPv,
  modelePvEquipement,
  statutSuivi,
  valeurLisible,
  type EquipementDto,
  type PrepAffaireDto,
  type PvDetailDto,
  type PvRelaisData,
  type PvResumeDto,
  type SectionRelaisId,
  type TypeFichier,
} from "@spie/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { Link, useParams } from "react-router";
import { BadgeStatutPv, BadgesDepots, LiensSharePoint } from "../../components/statuts";
import { Alert, Badge, Button, Card, Loading, PageHeader, Table, Td } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { useUser } from "../../lib/auth";
import { downloadFile } from "../../lib/files";
import { formatDateTime } from "../../lib/format";
import type { MajPv } from "../../pv/editor/context";
import { PvEditor } from "../../pv/editor/PvEditor";

/**
 * Préparation d'un PV au bureau (spec §3.1 étape 3, §4.6) : même formulaire que la tablette en mode « préparation »,
 * affectation des techniciens, duplication. Une fois reçu, consultation : valeurs préparées modifiées, dépôts, fichiers.
 */
export function PvPrepPage() {
  const { pvId = "" } = useParams();
  const pv = useQuery({ queryKey: ["prep", "pv", pvId], queryFn: () => api<PvDetailDto>(`/api/prep/pv/${pvId}`) });
  if (pv.isPending) return <Loading />;
  if (pv.isError) return <Alert kind="error">{errorMessage(pv.error)}</Alert>;
  return <PvPrep key={pv.data.versionId} pv={pv.data} />;
}

function PvPrep({ pv }: { pv: PvDetailDto }) {
  const qc = useQueryClient();
  const user = useUser();
  const affaire = useQuery({
    queryKey: ["prep", "affaire", pv.affaireId],
    queryFn: () => api<PrepAffaireDto>(`/api/prep/affaires/${pv.affaireId}`),
  });
  const [donnees, setDonnees] = useState<PvRelaisData>(pv.donnees);
  const [modifie, setModifie] = useState(false);
  const [section, setSection] = useState<SectionRelaisId>("generalites");
  const preparation = pv.statut === "prepare";
  const maj: MajPv = useCallback((fn) => {
    setModifie(true);
    setDonnees((d) => fn(d));
  }, []);
  const trace = useCallback(() => ({ par: user.nom, le: new Date().toISOString() }), [user.nom]);

  const enregistrer = useMutation({
    mutationFn: () => api<PvDetailDto>(`/api/prep/pv/${pv.pvId}`, { method: "PUT", body: { donnees } }),
    onSuccess: (r) => {
      setModifie(false);
      qc.setQueryData(["prep", "pv", pv.pvId], r);
      void qc.invalidateQueries({ queryKey: ["prep", "affaire", pv.affaireId] });
    },
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title={`PV ${pv.numero}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Link to={`/preparation/affaires/${pv.affaireId}`} className="underline">
              {pv.affaireNumero}
            </Link>
            — {pv.equipementTag ?? "sans équipement"} — ind. {pv.indice} <BadgeStatutPv statut={statutSuivi(pv)} />
          </span>
        }
        actions={
          preparation && (
            <Button busy={enregistrer.isPending} disabled={!modifie} onClick={() => enregistrer.mutate()}>
              {modifie ? "Enregistrer la préparation" : "Préparation enregistrée"}
            </Button>
          )
        }
      />
      {pv.saisieCommenceeLe && preparation && (
        <Alert kind="warning">
          La saisie de ce PV a commencé sur tablette le {formatDateTime(pv.saisieCommenceeLe)} : la version de la
          tablette fait foi, vos modifications ne lui parviendront pas.
        </Alert>
      )}
      {enregistrer.isError && <Alert kind="error">{errorMessage(enregistrer.error)}</Alert>}
      {pv.alerteDoublon && <Alert kind="warning">Numéro identique à celui d'un autre PV de l'affaire.</Alert>}

      {preparation ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <Affectations pv={pv} affaire={affaire.data} />
          <Duplication pv={pv} affaire={affaire.data} />
        </div>
      ) : (
        <Reception pv={pv} />
      )}

      <PvEditor
        donnees={donnees}
        preparees={preparation ? null : pv.donneesPreparees}
        mode={preparation ? "preparation" : "saisie"}
        lectureSeule={!preparation}
        onChange={maj}
        trace={trace}
        section={section}
        onSection={setSection}
      />
    </div>
  );
}

function Affectations({ pv, affaire }: { pv: PvDetailDto; affaire: PrepAffaireDto | undefined }) {
  const qc = useQueryClient();
  const [ids, setIds] = useState<string[]>(pv.techniciens.map((t) => t.id));
  const enregistrer = useMutation({
    mutationFn: () =>
      api<PvDetailDto>(`/api/prep/pv/${pv.pvId}/affectations`, { method: "PUT", body: { userIds: ids } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["prep"] }),
  });
  return (
    <Card>
      <h2 className="mb-2 text-lg font-bold">Techniciens</h2>
      {!affaire ? (
        <Loading />
      ) : affaire.techniciens.length === 0 ? (
        <Alert kind="info">Aucun technicien n'est affecté à l'affaire.</Alert>
      ) : (
        <div className="space-y-1">
          {affaire.techniciens.map((t) => (
            <label key={t.id} className="flex min-h-12 items-center gap-3">
              <input
                type="checkbox"
                className="size-6"
                checked={ids.includes(t.id)}
                onChange={(e) => setIds(e.target.checked ? [...ids, t.id] : ids.filter((x) => x !== t.id))}
              />
              {t.nom}
            </label>
          ))}
        </div>
      )}
      {enregistrer.isError && <Alert kind="error">{errorMessage(enregistrer.error)}</Alert>}
      {enregistrer.isSuccess && <p className="text-green-800">Affectation enregistrée.</p>}
      <Button className="mt-2" variant="secondary" busy={enregistrer.isPending} onClick={() => enregistrer.mutate()}>
        Enregistrer l'affectation
      </Button>
    </Card>
  );
}

/**
 * Cibles de duplication (spec §4.6) : équipements dotés d'un modèle de PV (pas le régulateur), autres que la
 * source ; ceux du même type de cellule à part (ex. les 5 départs batterie). Triés par TAG.
 */
export function ciblesDuplication(
  equipements: readonly EquipementDto[],
  sourceId: string | null,
): { memeType: EquipementDto[]; autres: EquipementDto[] } {
  const source = equipements.find((e) => e.id === sourceId);
  const cibles = equipements
    .filter((e) => e.id !== sourceId && modelePvEquipement(e))
    .sort((a, b) => a.tag.localeCompare(b.tag));
  const meme = (e: EquipementDto) => Boolean(source) && e.typeCellule === source!.typeCellule;
  return { memeType: cibles.filter(meme), autres: cibles.filter((e) => !meme(e)) };
}

function Duplication({ pv, affaire }: { pv: PvDetailDto; affaire: PrepAffaireDto | undefined }) {
  const qc = useQueryClient();
  const [ids, setIds] = useState<string[]>([]);
  const dupliquer = useMutation({
    mutationFn: () =>
      api<PvResumeDto[]>(`/api/prep/pv/${pv.pvId}/duplicate`, { method: "POST", body: { equipementIds: ids } }),
    onSuccess: () => {
      setIds([]);
      void qc.invalidateQueries({ queryKey: ["prep"] });
    },
  });
  const { memeType, autres } = ciblesDuplication(affaire?.equipements ?? [], pv.equipementId);
  const ligne = (e: EquipementDto) => {
    const existe = e.avancement.nbPv > 0;
    return (
      <label key={e.id} className={`flex min-h-12 items-center gap-3 ${existe ? "text-slate-500" : ""}`}>
        <input
          type="checkbox"
          className="size-6"
          disabled={existe}
          checked={ids.includes(e.id)}
          onChange={(ev) => setIds(ev.target.checked ? [...ids, e.id] : ids.filter((x) => x !== e.id))}
        />
        <span>
          <strong>{e.tag}</strong> <span className="text-slate-600">{e.typeCellule || "type cellule vide"}</span>
          {existe && (
            <span className="ml-2">
              <Badge tone="neutral">a déjà {e.avancement.nbPv} PV</Badge>
            </span>
          )}
        </span>
      </label>
    );
  };
  return (
    <Card>
      <h2 className="mb-1 text-lg font-bold">Dupliquer vers d'autres équipements</h2>
      <p className="mb-2 text-sm text-slate-600">
        Reprend la préparation ; la liste E/S, le n° de série et l'adresse IP viennent de l'équipement cible. Un
        équipement qui a déjà un PV n'est pas proposé ; le régulateur de tension n'a pas de modèle de PV.
      </p>
      {!affaire ? (
        <Loading />
      ) : (
        <div className="max-h-80 space-y-1 overflow-auto">
          <p className="text-sm font-semibold uppercase text-slate-600">Même type de cellule</p>
          {memeType.length === 0 ? <p className="text-sm text-slate-600">Aucun.</p> : memeType.map(ligne)}
          {autres.length > 0 && (
            <>
              <p className="pt-2 text-sm font-semibold uppercase text-slate-600">Autres équipements</p>
              {autres.map(ligne)}
            </>
          )}
        </div>
      )}
      {dupliquer.isError && <Alert kind="error">{errorMessage(dupliquer.error)}</Alert>}
      {dupliquer.isSuccess && (
        <div className="text-green-800">
          <p>{dupliquer.data.length} PV créé(s) :</p>
          <ul className="list-disc pl-6">
            {dupliquer.data.map((p) => (
              <li key={p.pvId}>
                <Link to={`/preparation/pv/${p.pvId}`} className="font-semibold underline">
                  {p.numero}
                </Link>{" "}
                — {p.equipementTag}
              </li>
            ))}
          </ul>
        </div>
      )}
      <Button
        className="mt-2"
        variant="secondary"
        disabled={ids.length === 0}
        busy={dupliquer.isPending}
        onClick={() => dupliquer.mutate()}
      >
        Dupliquer ({ids.length})
      </Button>
    </Card>
  );
}

const FICHIERS: TypeFichier[] = ["pdf", "json", "xlsx"];

function Reception({ pv }: { pv: PvDetailDto }) {
  const [erreur, setErreur] = useState<string | null>(null);
  return (
    <div className="space-y-5">
      <Card>
        <h2 className="mb-2 text-lg font-bold">Réception et dépôt</h2>
        <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-[max-content_1fr]">
          <dt className="text-slate-600">Signé le</dt>
          <dd>{formatDateTime(pv.signeLe)}</dd>
          <dt className="text-slate-600">Reçu le</dt>
          <dd>{formatDateTime(pv.recuLe)}</dd>
          <dt className="text-slate-600">Statut du document</dt>
          <dd>{pv.statutDocument ?? "—"}</dd>
          <dt className="text-slate-600">Empreinte SHA-256</dt>
          <dd className="break-all font-mono text-sm">{pv.empreinte ?? "—"}</dd>
          <dt className="text-slate-600">Dépôts</dt>
          <dd>
            <BadgesDepots depots={pv.depots} />
          </dd>
        </dl>
        <div className="mt-3 flex flex-wrap gap-2">
          {FICHIERS.filter((f) => pv.depots.some((d) => d.fichier === f)).map((f) => (
            <Button
              key={f}
              variant="secondary"
              onClick={() =>
                downloadFile(`/api/prep/versions/${pv.versionId}/fichiers/${f}`, `${pv.numero}.${f}`).catch(
                  (e: unknown) => setErreur(errorMessage(e)),
                )
              }
            >
              Télécharger le {f.toUpperCase()}
            </Button>
          ))}
          <LiensSharePoint depots={pv.depots} />
        </div>
        {erreur && <Alert kind="error">{erreur}</Alert>}
      </Card>
      <Card>
        <h2 className="mb-2 text-lg font-bold">Valeurs pré-remplies modifiées sur site ({pv.modifications.length})</h2>
        {pv.modifications.length === 0 ? (
          <p className="text-slate-600">Aucune valeur préparée n'a été modifiée.</p>
        ) : (
          <Table head={["Champ", "Valeur préparée", "Valeur sur site", "Par", "Le"]}>
            {pv.modifications.map((m) => (
              <tr key={m.chemin} className="align-top">
                <Td className="text-sm font-semibold">
                  <span title={m.chemin}>{libelleCheminPv(m.chemin, pv.donneesPreparees ?? pv.donnees)}</span>
                </Td>
                <Td className="whitespace-pre-line text-sm">{valeurLisible(m.avant)}</Td>
                <Td className="whitespace-pre-line text-sm">
                  {m.apres === null ? <em>supprimé</em> : valeurLisible(m.apres)}
                </Td>
                <Td className="text-sm">{m.par}</Td>
                <Td className="text-sm">{formatDateTime(m.le)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
