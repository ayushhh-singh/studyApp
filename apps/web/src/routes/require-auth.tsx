import { Navigate, Outlet, useLocation } from "react-router";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/providers/auth-provider";
import { useProfile } from "@/hooks/use-profile";
import { useLocale } from "@/hooks/use-locale";

/** Centered full-screen spinner used while auth/profile state resolves. */
export function FullScreenLoader() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background">
      <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading" />
    </div>
  );
}

/**
 * Guards the entire app-shell + full-screen route group.
 *   - No session → bounce to /:locale/auth, preserving the intended path so the
 *     user lands back where they were headed after signing in.
 *   - Signed in but onboarding not finished → bounce to /:locale/onboarding
 *     (except when already there).
 * Gated on both auth loading and the profile query so we never flash a
 * protected screen before the redirect decision is made.
 */
export function Component() {
  const locale = useLocale();
  const location = useLocation();
  const { session, loading } = useAuth();

  const onboardingPath = `/${locale}/onboarding`;
  const isOnboardingRoute = location.pathname === onboardingPath;

  // Only fetch the profile once we know there's a session (avoids a doomed
  // unauthenticated request while auth is still resolving).
  const profileQuery = useProfile({ enabled: !!session && !loading });

  if (loading) return <FullScreenLoader />;

  if (!session) {
    const intended = `${location.pathname}${location.search}`;
    const params = new URLSearchParams({ redirect: intended });
    return <Navigate to={`/${locale}/auth?${params.toString()}`} replace />;
  }

  if (profileQuery.isLoading) return <FullScreenLoader />;

  const onboarded = profileQuery.data?.onboarding_completed ?? false;
  if (!onboarded && !isOnboardingRoute) {
    return <Navigate to={onboardingPath} replace />;
  }

  return <Outlet />;
}
