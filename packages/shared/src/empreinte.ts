/**
 * Empreinte SHA-256 d'un PV signé (spec §3.2, §7.4). Calculée sur la tablette à la validation, vérifiée par le
 * serveur et imprimée sur le PDF. Les deux côtés doivent produire exactement les mêmes octets : on hache une
 * sérialisation JSON canonique (clés triées, aucun espace), via WebCrypto (navigateur et Node).
 */

/** JSON canonique : clés d'objet triées, `undefined` omis comme dans JSON.stringify, tableaux dans l'ordre. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new TypeError("Nombre non fini : non sérialisable en JSON canonique.");
    }
    if (value === undefined || typeof value === "function" || typeof value === "symbol") {
      throw new TypeError("Valeur non sérialisable en JSON canonique.");
    }
    if (typeof value === "bigint") throw new TypeError("BigInt non sérialisable en JSON canonique.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",")}]`;
  }
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined && typeof v !== "function" && typeof v !== "symbol")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Ce qui est couvert par l'empreinte : l'identité du PV et la totalité de ses données (signatures comprises). */
export interface ContenuEmpreinte {
  pvId: string;
  versionId: string;
  numero: string;
  indice: string;
  signeLe: string;
  donnees: unknown;
}

export function empreintePv(c: ContenuEmpreinte): Promise<string> {
  return sha256Hex(
    canonicalJson({
      pvId: c.pvId,
      versionId: c.versionId,
      numero: c.numero,
      indice: c.indice,
      signeLe: c.signeLe,
      donnees: c.donnees,
    }),
  );
}
