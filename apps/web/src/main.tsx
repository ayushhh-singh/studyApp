import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router";
import { HelmetProvider } from "react-helmet-async";
import "@fontsource-variable/inter";
// Devanagari-only subset files (not the generic 400.css/etc, which bundle
// every script Noto Sans Devanagari ships — latin, Devanagari, and more, each
// its own @font-face) — this font is only ever used for Devanagari glyphs
// here, Latin text renders in Inter.
import "@fontsource/noto-sans-devanagari/devanagari-400.css";
import "@fontsource/noto-sans-devanagari/devanagari-500.css";
import "@fontsource/noto-sans-devanagari/devanagari-700.css";
import "@/lib/i18n";
import "@/index.css";
// Side-effect import: applies the persisted dark-mode preference to <html>
// immediately on load. Previously this only happened when top-bar.tsx or
// settings-card.tsx (both inside the authenticated app-shell) pulled the
// module in transitively — any route that renders without either (landing,
// /pricing, /auth) never applied a saved theme. Importing it here, at the
// true entry point, guarantees it always runs before the router mounts.
import "@/stores/theme-store";
import { router } from "@/router";
import { AuthProvider } from "@/providers/auth-provider";
import { PwaUpdateToast } from "@/components/app-shell/pwa-update-toast";
import { RootErrorBoundary } from "@/components/app-shell/root-error-boundary";
import { initSentry } from "@/lib/sentry";

void initSentry();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
      <HelmetProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <RouterProvider router={router} />
            <PwaUpdateToast />
          </AuthProvider>
        </QueryClientProvider>
      </HelmetProvider>
    </RootErrorBoundary>
  </StrictMode>,
);
