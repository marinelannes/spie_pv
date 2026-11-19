import type { TestUploadRequest, TestUploadResponse } from "@spie/shared";
import { useMutation } from "@tanstack/react-query";
import { api, errorMessage } from "../lib/api";
import { Alert, Button } from "./ui";

/** Bouton de dépôt d'un fichier de test dans SharePoint (critère de fin du lot 0) et résultat. */
export function TestUploadButton({
  target,
  label = "Déposer un fichier de test",
}: {
  target: TestUploadRequest;
  label?: string;
}) {
  const upload = useMutation({
    mutationFn: () => api<TestUploadResponse>("/api/admin/sharepoint/test-upload", { method: "POST", body: target }),
  });

  return (
    <div className="space-y-3">
      <Button variant="secondary" busy={upload.isPending} onClick={() => upload.mutate()}>
        {label}
      </Button>
      {upload.isError && <Alert kind="error">{errorMessage(upload.error)}</Alert>}
      {upload.isSuccess && (
        <Alert kind="success">
          <p className="font-semibold">Fichier déposé</p>
          <p className="mt-1 break-all font-mono text-sm">{upload.data.name}</p>
          <p className="mt-1 text-sm">Dossier : {upload.data.folderPath}</p>
          {upload.data.webUrl?.startsWith("https://") && (
            <a
              href={upload.data.webUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block font-semibold underline"
            >
              Ouvrir dans SharePoint
            </a>
          )}
        </Alert>
      )}
    </div>
  );
}
