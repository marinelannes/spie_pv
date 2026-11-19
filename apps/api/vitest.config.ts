import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    // Chaque fichier de test démarre sa propre base PGlite en mémoire.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
