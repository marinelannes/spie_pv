import { randomInt } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

// @node-rs/argon2 utilise argon2id par défaut (spec §7.1), avec les paramètres recommandés par l'OWASP
// (19 Mio, 2 itérations, parallélisme 1).

export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | null = null;

/**
 * Vérifie le mot de passe contre une empreinte factice, pour qu'une adresse inconnue prenne
 * le même temps de réponse qu'une adresse existante.
 */
export async function burnPasswordVerification(password: string): Promise<void> {
  dummyHash ??= hash("mot-de-passe-factice-pour-egaliser-les-temps");
  await verifyPassword(await dummyHash, password);
}

// Sans caractères ambigus (0/O, 1/l/I) : le mot de passe provisoire est souvent dicté ou recopié.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

/** Mot de passe provisoire : 4 groupes de 4 caractères (≈ 92 bits), ex. « Kx7m-Pq2r-Tz9w-Hb4n ». */
export function generateTemporaryPassword(): string {
  const groups: string[] = [];
  for (let g = 0; g < 4; g++) {
    let group = "";
    for (let i = 0; i < 4; i++) group += ALPHABET[randomInt(ALPHABET.length)];
    groups.push(group);
  }
  return groups.join("-");
}
