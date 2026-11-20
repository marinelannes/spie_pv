import type { AffaireListItemDto, DossierSharePoint, SharePointStatusDto } from "@spie/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { FamillesSharePoint } from "../../components/FamillesSharePoint";
import { SharePointFolderPicker } from "../../components/SharePointFolderPicker";
import { TestUploadButton } from "../../components/TestUpload";
import { Alert, Badge, Button, Card, Loading, PageHeader, Select } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";

const MODE_LABELS: Record<SharePointStatusDto["mode"], string> = {
  graph: "Microsoft Graph (site réel)",
  fake: "Simulé (dossier local du serveur)",
  disabled: "Désactivé",
};

export function SharePointPage() {
  const status = useQuery({
    queryKey: ["admin", "sharepoint", "status"],
    queryFn: () => api<SharePointStatusDto>("/api/admin/sharepoint/status"),
  });
  const affaires = useQuery({
    queryKey: ["admin", "affaires", "non"],
    queryFn: () => api<AffaireListItemDto[]>("/api/admin/affaires?archivees=non"),
  });
  const [affaireId, setAffaireId] = useState("");
  const [picking, setPicking] = useState(false);
  const [dossier, setDossier] = useState<DossierSharePoint | null>(null);
  const avecDossier = (affaires.data ?? []).filter((a) => a.dossierSharePoint);

  return (
    <>
      <PageHeader
        title="SharePoint"
        subtitle="Connexion au site cible, dossiers de dépôt par famille de PV et test de dépôt."
      />
      <div className="space-y-6">
        <Card>
          <h2 className="mb-3 text-lg font-semibold">État de la connexion</h2>
          {status.isPending ? (
            <Loading />
          ) : status.isError ? (
            <Alert kind="error">{errorMessage(status.error)}</Alert>
          ) : (
            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
              <dt className="font-medium text-slate-600">Mode</dt>
              <dd>
                <Badge tone={status.data.mode === "graph" ? "green" : status.data.mode === "fake" ? "amber" : "red"}>
                  {MODE_LABELS[status.data.mode]}
                </Badge>
              </dd>
              <dt className="font-medium text-slate-600">Site</dt>
              <dd>
                {status.data.site ? (
                  <>
                    {status.data.site.name}
                    {status.data.site.webUrl?.startsWith("https://") && (
                      <a
                        href={status.data.site.webUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-2 text-brand-700 underline"
                      >
                        ouvrir
                      </a>
                    )}
                  </>
                ) : (
                  "—"
                )}
              </dd>
              {status.data.error && (
                <div className="sm:col-span-2">
                  <Alert kind="error">{status.data.error}</Alert>
                </div>
              )}
            </dl>
          )}
          {status.data?.mode === "fake" && (
            <p className="mt-4 text-sm text-slate-600">
              Mode de développement : les fichiers sont écrits sur le disque du serveur, pas dans SharePoint.
            </p>
          )}
        </Card>

        <FamillesSharePoint />

        <Card>
          <h2 className="mb-1 text-lg font-semibold">Dépôt de test dans le dossier d'une affaire</h2>
          <p className="mb-4 text-slate-600">
            Vérifie que l'application peut écrire dans le dossier cible (permission Sites.Selected en écriture).
          </p>
          {affaires.isPending ? (
            <Loading />
          ) : avecDossier.length === 0 ? (
            <Alert kind="info">Aucune affaire active n'a de dossier SharePoint cible.</Alert>
          ) : (
            <div className="space-y-4">
              <Select
                value={affaireId}
                onChange={(e) => setAffaireId(e.target.value)}
                aria-label="Affaire"
                className="max-w-xl"
              >
                <option value="">Choisir une affaire…</option>
                {avecDossier.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.numero} — {a.dossierSharePoint!.path}
                  </option>
                ))}
              </Select>
              {affaireId && <TestUploadButton key={affaireId} target={{ affaireId }} />}
            </div>
          )}
        </Card>

        <Card>
          <h2 className="mb-1 text-lg font-semibold">Dépôt de test dans un dossier quelconque</h2>
          <p className="mb-4 text-slate-600">Pour tester les droits avant d'avoir créé une affaire.</p>
          {picking ? (
            <SharePointFolderPicker
              initial={dossier}
              onCancel={() => setPicking(false)}
              onSelect={(d) => {
                setDossier(d);
                setPicking(false);
              }}
            />
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                {dossier && <span className="font-mono text-sm">{dossier.path}</span>}
                <Button
                  variant="secondary"
                  onClick={() => setPicking(true)}
                  disabled={status.data?.mode === "disabled"}
                >
                  {dossier ? "Changer de dossier" : "Parcourir le site"}
                </Button>
              </div>
              {dossier && (
                <TestUploadButton key={dossier.itemId} target={{ driveId: dossier.driveId, itemId: dossier.itemId }} />
              )}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
