import type { DossierSharePoint, SharePointBrowseResponse } from "@spie/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, errorMessage } from "../lib/api";
import { Alert, Button, Loading } from "./ui";

type Position = { driveId?: string; itemId?: string };

/** Navigation dans le site SharePoint cible pour choisir un dossier (spec §4.6). */
export function SharePointFolderPicker({
  initial,
  onSelect,
  onCancel,
}: {
  initial?: DossierSharePoint | null;
  onSelect: (d: DossierSharePoint) => void;
  onCancel: () => void;
}) {
  const [pos, setPos] = useState<Position>(initial ? { driveId: initial.driveId, itemId: initial.itemId } : {});
  const params = new URLSearchParams();
  if (pos.driveId) params.set("driveId", pos.driveId);
  if (pos.itemId) params.set("itemId", pos.itemId);
  const browse = useQuery({
    queryKey: ["admin", "sharepoint", "browse", pos],
    queryFn: () => api<SharePointBrowseResponse>(`/api/admin/sharepoint/browse?${params}`),
  });
  const current = browse.data?.current;

  return (
    <div className="rounded-xl border-2 border-brand-200 bg-brand-50 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          disabled={!pos.driveId}
          onClick={() => {
            const parent = browse.data?.parent;
            setPos(parent ? { driveId: parent.driveId, itemId: parent.itemId } : {});
          }}
        >
          ← Remonter
        </Button>
        <p className="font-semibold">{current ? current.path : "Bibliothèques du site"}</p>
      </div>

      {browse.isPending ? (
        <Loading />
      ) : browse.isError ? (
        <Alert kind="error">{errorMessage(browse.error)}</Alert>
      ) : browse.data.items.length === 0 ? (
        <p className="py-4 text-slate-600">Aucun sous-dossier.</p>
      ) : (
        <ul className="max-h-80 divide-y divide-slate-200 overflow-y-auto rounded-lg bg-white">
          {browse.data.items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="flex min-h-12 w-full items-center gap-3 px-4 text-left hover:bg-brand-50"
                onClick={() =>
                  setPos(item.kind === "drive" ? { driveId: item.driveId } : { driveId: item.driveId, itemId: item.id })
                }
              >
                <span aria-hidden>{item.kind === "drive" ? "📚" : "📁"}</span>
                {item.name}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        <Button
          disabled={!current}
          onClick={() =>
            current &&
            onSelect({ driveId: current.driveId, itemId: current.itemId, path: current.path, webUrl: current.webUrl })
          }
        >
          Choisir ce dossier
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </div>
  );
}
