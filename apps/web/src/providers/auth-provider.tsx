import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase";
import { setUnauthorizedHandler } from "@/lib/auth";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  /** True until the initial getSession() resolves — gate route guards on this. */
  loading: boolean;
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
