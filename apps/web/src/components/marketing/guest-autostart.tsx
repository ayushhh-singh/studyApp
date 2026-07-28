import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/providers/auth-provider";
import { useLocale } from "@/hooks/use-locale";
import { guestAutostartAlreadyTried, markGuestAutostartTried } from "@/lib/guest";

/**
 * On a first, session-less visit to the landing page, silently create a guest
 * (anonymous) session and drop the visitor straight into the real app — so a
 * newcomer explores the product instead of bouncing off a static marketing page.
 *
 * Renders nothing. Robustness:
 *   - Skips bots/prerender (navigator.webdriver) so crawlers still get the
 *     prerendered marketing HTML and the build's prerender pass creates no junk
 *     guest rows.
 *   - One attempt per tab (sessionStorage), so a disabled/rate-limited failure
 *     doesn't retry on every re-render or navigation back to the landing page.
 *   - Fails open: any error (anonymous sign-in disabled, our per-IP 429, offline)
 *     leaves the visitor on the fully-rendered landing page.
 *   - Only auto-navigates the guest it just created (started ref) — a RETURNING
 *     guest who deliberately visits the landing is left there with its normal CTA.
 */
export function GuestAutostart() {
  const { session, loading, signInAnonymously } = useAuth();
  const locale = useLocale();
  const navigate = useNavigate();
  const started = useRef(false);

  useEffect(() => {
    if (loading) return;
    if (session) {
      // The guest session we just started has landed in provider state — go.
      if (started.current) navigate(`/${locale}/dashboard`, { replace: true });
      return;
    }
    if (started.current) return; // sign-in in flight
    if (typeof navigator !== "undefined" && navigator.webdriver) return; // bots / prerender
    if (guestAutostartAlreadyTried()) return; // one attempt per tab
    started.current = true;
    markGuestAutostartTried();
    signInAnonymously().catch(() => {
      // Disabled / rate-limited / offline — stay on the landing page. The
      // per-tab flag above prevents a retry loop.
      started.current = false;
    });
  }, [loading, session, signInAnonymously, navigate, locale]);

  return null;
}
