import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { vendorPaged } from "./plugins/vendor-paged";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Avant VitePWA : les scripts de l'aperçu (/vendor/*.js) doivent être émis avant la génération du service worker.
    vendorPaged(),
    VitePWA({
      // Une nouvelle version est proposée à l'utilisateur, jamais appliquée d'office (spec §6.2).
      registerType: "prompt",
      injectRegister: false,
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "PV SPIE",
        short_name: "PV SPIE",
        description: "Saisie des procès-verbaux SPIE sur tablette",
        lang: "fr",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "any",
        background_color: "#f8f8f8",
        theme_color: "#0f1e5a",
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        // L'application (avec le rendu des modèles de PV) et la polyfill Paged.js doivent être disponibles hors ligne.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: "/index.html",
        // /sharepoint-simule/ : fichiers déposés dans le SharePoint simulé (développement), ouverts depuis leur lien.
        navigateFallbackDenylist: [/^\/api\//, /^\/sharepoint-simule\//],
      },
    }),
  ],
  server: {
    port: 5173,
    // L'API tourne sur :3000 ; le proxy garde la PWA et l'API sur la même origine (cookie SameSite=Strict).
    proxy: { "/api": "http://localhost:3000" },
  },
  build: { sourcemap: true },
});
