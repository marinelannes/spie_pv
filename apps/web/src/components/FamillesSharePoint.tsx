import { cheminRelatifSchema, type FamilleSharePointDto } from "@spie/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, errorMessage } from "../lib/api";
import { Alert, Button, Card, Input, Loading } from "./ui";

/** Paramétrage SharePoint (spec §4.6, §5.2) : chemin relatif par famille de PV, sous le dossier de l'affaire. */
export function FamillesSharePoint() {
  const qc = useQueryClient();
  const familles = useQuery({
    queryKey: ["admin", "sharepoint", "familles"],
    queryFn: () => api<FamilleSharePointDto[]>("/api/admin/sharepoint/familles"),
  });
  const [saisie, setSaisie] = useState<Record<string, string>>({});
  const valeur = (f: FamilleSharePointDto) => saisie[f.famille] ?? f.cheminRelatif;
  const enregistrer = useMutation({
    mutationFn: (liste: FamilleSharePointDto[]) =>
      api<FamilleSharePointDto[]>("/api/admin/sharepoint/familles", {
        method: "PUT",
        body: { familles: liste.map((f) => ({ famille: f.famille, cheminRelatif: valeur(f) })) },
      }),
    onSuccess: (r) => {
      setSaisie({});
      qc.setQueryData(["admin", "sharepoint", "familles"], r);
    },
  });
  const erreurs = (familles.data ?? [])
    .map((f) => ({ f, r: cheminRelatifSchema.safeParse(valeur(f)) }))
    .filter((x) => !x.r.success)
    .map((x) => `${x.f.libelle} : ${x.r.error!.issues[0]?.message}`);

  return (
    <Card>
      <h2 className="mb-1 text-lg font-bold">Dossiers de dépôt par famille de PV</h2>
      <p className="mb-4 text-slate-600">
        Dossier de dépôt = dossier SharePoint de l'affaire + chemin relatif de la famille (ex. « 03 - Mise en service/PV
        »). Vide : à la racine du dossier de l'affaire.
      </p>
      {familles.isPending ? (
        <Loading />
      ) : familles.isError ? (
        <Alert kind="error">{errorMessage(familles.error)}</Alert>
      ) : (
        <div className="space-y-4">
          {familles.data.map((f) => (
            <label key={f.famille} className="block space-y-1">
              <span className="font-medium">
                {f.libelle} ({f.famille})
              </span>
              <Input
                value={valeur(f)}
                onChange={(e) => setSaisie({ ...saisie, [f.famille]: e.target.value })}
                placeholder="03 - Mise en service/PV"
              />
            </label>
          ))}
          {erreurs.length > 0 && <Alert kind="error">{erreurs.join(" ")}</Alert>}
          {enregistrer.isError && <Alert kind="error">{errorMessage(enregistrer.error)}</Alert>}
          {enregistrer.isSuccess && Object.keys(saisie).length === 0 && (
            <Alert kind="success">Paramétrage enregistré.</Alert>
          )}
          <Button
            variant="secondary"
            busy={enregistrer.isPending}
            disabled={erreurs.length > 0 || Object.keys(saisie).length === 0}
            onClick={() => enregistrer.mutate(familles.data)}
          >
            Enregistrer
          </Button>
        </div>
      )}
    </Card>
  );
}
