import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import { UpdatePrompt } from "./components/UpdatePrompt";
import "./index.css";
import { ApiError } from "./lib/api";
import { AuthProvider } from "./lib/auth";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

// Demande au navigateur de ne pas purger les données locales (spec §6.2).
void navigator.storage?.persist?.().catch(() => undefined);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
        <UpdatePrompt />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
