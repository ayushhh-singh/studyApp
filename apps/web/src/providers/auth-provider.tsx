import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase";
import { setUnauthorizedHandler } from "@/lib/auth";
import { api } from "@/lib/api";
import { guestGateResponseSchema } from "@neev/shared";
import { markTrialClaimPending } from "@/lib/guest";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  /** True until the initial getSession() resolves — gate route guards on this. */
  loading: boolean;
  /** True for a Supabase native anonymous (guest) session — gates AI/paid surfaces behind signup. */
  isGuest: boolean;
  /**
   * Create a guest (anonymous) session. Goes through our public per-IP checkpoint
   * (POST /auth/guest) first — a 429 there (ApiError) means "too many from this
   * IP", and Supabase itself may also reject if anonymous sign-ins are disabled or
   * over its own per-IP limit. Callers treat any throw as "stay on the landing".
   */
  signInAnonymously: () => Promise<void>;
  /**
   * Link a Google identity to the CURRENT (guest) session, converting it to a
   * real account while keeping the same user id (so guest progress is preserved).
   * Requires "manual linking" enabled on the project. Marks a pending trial claim.
   */
  linkGoogle: (redirectTo: string) => Promise<void>;
  /**
   * Add email+password to the CURRENT (guest) session via updateUser, converting
   * it in place (same user id → data preserved). Marks a pending trial claim.
   * Returns `needsConfirmation: true` if the project requires email confirmation
   * (the session stays anonymous until the emailed link is clicked).
   */
  convertGuestWithPassword: (email: string, password: string) => Promise<{ needsConfirmation: boolean }>;
  signInWithGoogle: (redirectTo: string) => Promise<void>;
  /** Email + password sign-in (no email sent — sidesteps the OTP rate limit). */
  signInWithPassword: (email: string, password: string) => Promise<void>;
  /**
   * Create an account with email + password. Returns `needsConfirmation: true`
   * when the project requires email confirmation (no session yet); `false` when
   * the sign-up logged the user straight in.
   */
  signUpWithPassword: (email: string, password: string) => Promise<{ needsConfirmation: boolean }>;
  /** Send a 6-digit email OTP. shouldCreateUser so first-time sign-ups work. */
  sendEmailOtp: (email: string) => Promise<void>;
  verifyEmailOtp: (email: string, token: string) => Promise<void>;
  /** Emails a recovery link that lands on redirectTo carrying a recovery code. */
  sendPasswordReset: (email: string, redirectTo: string) => Promise<void>;
  /** Sets a new password on the CURRENT session (recovery session or a normal signed-in one). */
  updatePassword: (password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = supabaseBrowser();
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });

    // When the API rejects us as unauthenticated (dead refresh token), sign out
    // fully — onAuthStateChange then clears the session and RequireAuth redirects.
    setUnauthorizedHandler(() => {
      void supabase.auth.signOut();
    });

    return () => {
      active = false;
      subscription.unsubscribe();
      setUnauthorizedHandler(null);
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      isGuest: session?.user?.is_anonymous === true,
      async signInAnonymously() {
        // App-level per-IP gate (graceful nudge before Supabase's own 30/hr/IP
        // limit). A 429 here throws an ApiError the caller handles.
        await api.post("/api/v1/auth/guest", guestGateResponseSchema);
        const { error } = await supabaseBrowser().auth.signInAnonymously();
        if (error) throw error;
      },
      async linkGoogle(redirectTo) {
        markTrialClaimPending();
        const { error } = await supabaseBrowser().auth.linkIdentity({
          provider: "google",
          options: { redirectTo },
        });
        if (error) throw error;
      },
      async convertGuestWithPassword(email, password) {
        markTrialClaimPending();
        const { data, error } = await supabaseBrowser().auth.updateUser({ email, password });
        if (error) throw error;
        // With email confirmations off (this project's default), the user is
        // converted immediately (is_anonymous → false). With them on, the row
        // stays anonymous until the emailed link is clicked.
        return { needsConfirmation: data.user?.is_anonymous === true };
      },
      async signInWithGoogle(redirectTo) {
        const { error } = await supabaseBrowser().auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo },
        });
        if (error) throw error;
      },
      async signInWithPassword(email, password) {
        const { error } = await supabaseBrowser().auth.signInWithPassword({ email, password });
        if (error) throw error;
      },
      async signUpWithPassword(email, password) {
        const { data, error } = await supabaseBrowser().auth.signUp({ email, password });
        if (error) throw error;
        // With email confirmation on, signUp returns a user but no session.
        return { needsConfirmation: !data.session };
      },
      async sendEmailOtp(email) {
        const { error } = await supabaseBrowser().auth.signInWithOtp({
          email,
          options: { shouldCreateUser: true },
        });
        if (error) throw error;
      },
      async verifyEmailOtp(email, token) {
        const { error } = await supabaseBrowser().auth.verifyOtp({ email, token, type: "email" });
        if (error) throw error;
      },
      async sendPasswordReset(email, redirectTo) {
        const { error } = await supabaseBrowser().auth.resetPasswordForEmail(email, { redirectTo });
        if (error) throw error;
      },
      async updatePassword(password) {
        const { error } = await supabaseBrowser().auth.updateUser({ password });
        if (error) throw error;
      },
      async signOut() {
        await supabaseBrowser().auth.signOut();
      },
    }),
    [session, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
