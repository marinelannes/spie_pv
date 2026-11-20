import { ApiError, apiFetch } from "./api";

/** Contenu d'un fichier encodé en base64 (sans le préfixe data URL), pour l'envoi JSON d'un classeur Excel. */
export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Lecture du fichier impossible."));
    reader.onload = () => {
      const url = String(reader.result ?? "");
      const i = url.indexOf(",");
      resolve(i >= 0 ? url.slice(i + 1) : url);
    };
    reader.readAsDataURL(file);
  });
}

/** Nom de fichier annoncé par l'en-tête Content-Disposition (RFC 6266, filename* prioritaire). */
export function fileNameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      // encodage invalide : on essaie filename=
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/.exec(header);
  return plain?.[1]?.trim() || fallback;
}

/** Télécharge un fichier protégé (jeton Bearer) puis le propose à l'enregistrement. */
export async function downloadFile(path: string, fallbackName: string): Promise<string> {
  const res = await apiFetch(path);
  if (!res.ok) throw new ApiError(res.status, "internal", `Téléchargement impossible (erreur ${res.status}).`);
  const name = fileNameFromDisposition(res.headers.get("Content-Disposition"), fallbackName);
  const url = URL.createObjectURL(await res.blob());
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  return name;
}
