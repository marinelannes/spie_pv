import type { CellValue } from "exceljs";

/**
 * Texte d'une cellule exceljs, quel que soit son type : texte riche, formule (résultat), lien hypertexte, date,
 * nombre, booléen. Une erreur (#N/A…) ou une cellule vide donne « ». Les fins de ligne sont ramenées à « \n ».
 */
export function texteCellule(v: CellValue | unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.replace(/\r\n?/g, "\n");
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "VRAI" : "FAUX";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  if (typeof v !== "object") return "";
  const o = v as Record<string, unknown>;
  if (Array.isArray(o.richText)) {
    return texteCellule((o.richText as { text?: unknown }[]).map((r) => texteCellule(r.text)).join(""));
  }
  if ("hyperlink" in o && "text" in o) return texteCellule(o.text);
  if ("formula" in o || "sharedFormula" in o) return texteCellule(o.result);
  if ("error" in o) return "";
  if ("text" in o) return texteCellule(o.text);
  return "";
}

/** Texte de cellule sans espaces superflus (début, fin, espaces multiples, retours à la ligne). */
export function texteLigne(v: CellValue | unknown): string {
  return texteCellule(v).replace(/\s+/g, " ").trim();
}

/** Lettre de colonne Excel (1 → A, 27 → AA). */
export function lettreColonne(n: number): string {
  let s = "";
  let x = n;
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}
