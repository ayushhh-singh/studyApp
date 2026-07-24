import { useEffect, type ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { Loader2 } from "lucide-react";
import "@/sukoon/theme/index.css";
import { useAuth } from "@/providers/auth-provider";
import { useSukoonNightMode } from "@/sukoon/lib/use-sukoon-night-mode";
import { useSukoonProfile } from "@/sukoon/lib/use-sukoon-profile";
import { cn } from "@/lib/utils";

// index.html's static <title>/theme-color/favicon are Neev's — vite-plugin-pwa
// only swaps the manifest content per build (vite.config.ts), not the HTML
// template. In a standalone build there's no other Sukoon page that would ever
// overwrite these back to Neev's, so it's safe to set them once here (this root
// layout wraps every Sukoon page, onboarding included).
const IS_STANDALONE = import.meta.env.VITE_APP === "sukoon";

/**
 * Redirects a signed-in user who hasn't finished Sukoon onboarding to the
 * onboarding wizard — from anywhere in the module. Deliberately permissive
 * about NOT-onboarding cases so Sukoon stays reachable pre-login (Session 1's
 * design: the public Wellness card links here before auth):
 *   - No session (or auth still resolving) → render the page as a preview; the
 *     onboarding wizard itself asks an anonymous visitor to sign in.
 *   - Already on the onboarding route → render it (and avoid a redirect loop).
 *   - Profile fetch still pending → a themed spinner (avoids a flash of app
 *     content that then bounces to onboarding).
 *   - Profile fetch errored (429/network) → render the page rather than trap
 *     the user; a transient error isn't "not onboarded".
 */
function SukoonOnboardingGate({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const location = useLocation();
  const normalizedPath = location.pathname.replace(/\/+$/, "");
  const isOnboardingRoute = normalizedPath.endsWith("/onboarding");
  // Dev-only tooling (e.g. /sukoon/dev/crisis) is exempt from the onboarding
  // redirect so it stays usable without first completing onboarding.
  const isDevRoute = normalizedPath.includes("/dev/");

  const profileQuery = useSukoonProfile({ enabled: !!session && !loading });

  if (loading || !session || isOnboardingRoute || isDevRoute) return <>{children}</>;
  if (profileQuery.isPending) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading" />
      </div>
    );
  }
  if (profileQuery.isError) return <>{children}</>;

  const profile = profileQuery.data?.profile ?? null;
  if (!profile || !profile.onboarding_completed) {
    // Relative to this layout's mount path — resolves to /:locale/sukoon/onboarding
    // (integrated) or /onboarding (standalone) unchanged.
    return <Navigate to="onboarding" replace />;
  }
  return <>{children}</>;
}

/**
 * Sukoon's root layout — applies the scoped `.sukoon` theme (theme/index.css)
 * and the 9pm–6am `.sukoon-dark` auto-schedule to the WHOLE module subtree
 * (onboarding included), and runs the onboarding gate. The per-page chrome
 * (sidebar/bottom-nav) lives one level down in shell.tsx, so onboarding — a
 * nested sibling of the shell — renders full-screen without that chrome.
 */
export function Component() {
  const isNight = useSukoonNightMode();

  useEffect(() => {
    if (!IS_STANDALONE) return;
    document.title = "Sukoon — सुकून";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#2E2A5E");
    document.querySelector('link[rel="icon"]')?.setAttribute("href", "/sukoon-mark.svg");
  }, []);

  return (
    <div className={cn("sukoon min-h-svh bg-background text-foreground", isNight && "sukoon-dark")}>
      <SukoonOnboardingGate>
        <Outlet />
      </SukoonOnboardingGate>
    </div>
  );
}
