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
  /** Send a 6-digit email OTP. shouldCreateUser so first-time sign-ups work. */
  sendEmailOtp: (email: string) => Promise<void>;
  verifyEmailOtp: (email: string, token: string) => Promise<void>;
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
