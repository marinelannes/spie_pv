import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
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
        background_color: "#f8fafc",
        theme_color: "#0b3a75",
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
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
