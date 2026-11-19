import { defineConfig } from "tsup";

// Les paquets du monorepo (@spie/*) sont livrés en TypeScript : on les intègre au bundle.
// Les dépendances npm restent externes et sont installées dans l'image par `pnpm deploy`.
export default defineConfig({
  entry: ["src/server.ts", "src/worker.ts", "src/cli.ts"],
  format: ["esm"],
  platform: "node",
  target: "node20",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  splitting: true,
  noExternal: [/^@spie\//],
  // PGlite ne sert qu'au développement et aux tests (import dynamique) : jamais dans le bundle.
  external: ["@electric-sql/pglite"],
});
