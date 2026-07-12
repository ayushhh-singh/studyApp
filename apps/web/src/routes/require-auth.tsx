import { Navigate, Outlet, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/providers/auth-provider";
import { useProfile } from "@/hooks/use-profile";
import { useLocale } from "@/hooks/use-locale";
import { Button } from "@/components/ui/button";

/** Centered full-screen spinner used while auth/profile state resolves. */
export function FullScreenLoader() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background">
      <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading" />
    </div>
  );
}

/**
 * Shown when the profile fetch itself fails (429 rate limit, a network blip,
 * a transient 5xx) rather than just being slow. Previously neither guard
 * checked this at all — once the query settled (even via an ERROR, which
 * still clears isPending/isLoading), `profileQuery.data` stayed undefined and
 * both guards read that identically to "not onboarded", forcing a real user
 * with onboarding_completed=true in the database into a redirect loop with
 * no way out except waiting for the rate limit to clear on its own. A manual
 * retry — not a silent redirect — is the correct response to an error.
 */
export function ProfileLoadError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-3 bg-background px-6 text-center">
      <p className="max-w-xs text-sm text-muted-foreground">{t("Auth.profileLoadError")}</p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        {t("Auth.retry")}
      </Button>
    </div>
  );
}

/**
 * Guards the entire app-shell + full-screen route group.
 *   - No session → bounce to /:locale/auth, preserving the intended path so the
 *     user lands back where they were headed after signing in.
 *   - Signed in but onboarding not finished → bounce to /:locale/onboarding
 *     (except when already there).
 *   - Onboarded but the tour's welcome moment hasn't been seen yet → bounce to
 *     /:locale/welcome (except when already there) — this is what makes
 *     "wizard -> welcome -> Dashboard" true for every entry point, not just
 *     onboarding.tsx's own finish() navigation target.
 * Gated on both auth loading and the profile query so we never flash a
 * protected screen before the redirect decision is made.
 */
export function Component() {
  const locale = useLocale();
  const location = useLocation();
  const { session, loading } = useAuth();

  const onboardingPath = `/${locale}/onboarding`;
  const isOnboardingRoute = location.pathname === onboardingPath;
  const welcomePath = `/${locale}/welcome`;
  const isWelcomeRoute = location.pathname === welcomePath;

  // Only fetch the profile once we know there's a session (avoids a doomed
  // unauthenticated request while auth is still resolving).
  const profileQuery = useProfile({ enabled: !!session && !loading });

  if (loading) return <FullScreenLoader />;

  if (!session) {
    const intended = `${location.pathname}${location.search}`;
    const params = new URLSearchParams({ redirect: intended });
    return <Navigate to={`/${locale}/auth?${params.toString()}`} replace />;
  }

  // isPending (not isLoading): isLoading is `isPending && isFetching`, so on
  // the exact render where this query first flips from disabled to enabled
  // (right as `session`/`loading` resolve above), `isFetching` can still read
  // false for that one render even though no data has ever arrived — isLoading
  // is briefly false, profileQuery.data is undefined, and the onboarding check
  // below reads `onboarding_completed` as false and redirects to /onboarding
  // even for an account that has already completed it. isPending is true
  // for the entire span until real data (or an error) exists, which is the
  // actual condition we need to gate this redirect decision on.
  if (profileQuery.isPending) return <FullScreenLoader />;

  // A failed fetch (429, network blip, transient 5xx) is NOT the same as
  // "no data because this account hasn't onboarded" — treating them the same
  // is what forced a real onboarded user into a redirect loop. Offer a manual
  // retry instead of guessing.
  if (profileQuery.isError) return <ProfileLoadError onRetry={() => profileQuery.refetch()} />;

  const onboarded = profileQuery.data?.onboarding_completed ?? false;
  if (!onboarded && !isOnboardingRoute) {
    return <Navigate to={onboardingPath} replace />;
  }

  const welcomeSeen = profileQuery.data?.tour_state.welcome_seen ?? false;
  if (onboarded && !welcomeSeen && !isWelcomeRoute && !isOnboardingRoute) {
    return <Navigate to={welcomePath} replace />;
  }

  return <Outlet />;
}
