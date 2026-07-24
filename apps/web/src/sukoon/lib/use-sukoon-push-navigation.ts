import { useEffect } from "react";
import { useNavigate, useParams } from "react-router";

const IS_STANDALONE = import.meta.env.VITE_APP === "sukoon";

/**
 * Sukoon's own NOTIFICATION_NAVIGATE listener — mirrors
 * hooks/use-push-navigation.ts, which is mounted ONLY inside Neev's
 * authenticated app-shell (routes/app-shell.tsx). That shell never renders
 * while browsing Sukoon (shell.tsx is Sukoon's OWN chrome, a sibling of
 * Neev's, not nested inside it — see shell.tsx's own comment), so without
 * this, clicking a Sukoon reminder push while an already-open tab is sitting
 * on a Sukoon page would postMessage into a route tree with no listener,
 * silently failing to navigate.
 *
 * Handles both deploy modes from the SAME server-authored link shape (always
 * "/sukoon/..." — see apps/api/src/sukoon/services/reminders.ts's COPY
 * table): integrated prefixes with the current :locale segment; standalone
 * strips the "/sukoon" prefix (Sukoon is mounted at "/" there, not "/sukoon").
 * Only reacts to links that start with "/sukoon" so it never intercepts a
 * Neev-destined message that happens to arrive while a Sukoon tab has focus.
 */
export function useSukoonPushNavigation(): void {
  const navigate = useNavigate();
  const { locale } = useParams<{ locale?: string }>();

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    function onMessage(event: MessageEvent) {
      if (event.data?.type !== "NOTIFICATION_NAVIGATE") return;
      const link = event.data.link as unknown;
      if (typeof link !== "string" || !link.startsWith("/sukoon")) return;
      if (IS_STANDALONE) {
        navigate(link.replace(/^\/sukoon/, "") || "/");
      } else {
        navigate(`/${locale ?? "en"}${link}`);
      }
    }
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [navigate, locale]);
}
