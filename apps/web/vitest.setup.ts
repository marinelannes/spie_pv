// IndexedDB en mémoire (Dexie) et WebCrypto complet pour les tests en environnement jsdom.
import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// jsdom fournit `crypto.randomUUID` mais pas `crypto.subtle` (empreinte SHA-256 des PV).
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}

afterEach(() => cleanup());
