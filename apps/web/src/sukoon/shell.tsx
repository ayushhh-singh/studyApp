import { Outlet } from "react-router";
import { SukoonHeader } from "@/sukoon/components/sukoon-header";
import { SukoonSidebar } from "@/sukoon/components/sukoon-sidebar";
import { SukoonBottomNav } from "@/sukoon/components/sukoon-bottom-nav";
import { NotTherapyFooter } from "@/sukoon/components/not-therapy-footer";
import { SukoonPaywall } from "@/sukoon/components/sukoon-paywall";
import { SukoonBetaBanner } from "@/sukoon/components/sukoon-beta-banner";

/**
 * Sukoon's in-app chrome — sidebar on desktop, bottom-nav on mobile,
 * deliberately NOT Neev's app-shell.tsx (which would double up chrome). The
 * `.sukoon` theme + night-mode class are provided by the parent root layout
 * (root.tsx), which also runs the onboarding gate — so this layer is purely the
 * navigation frame for the five app tabs. Onboarding is a sibling of this
 * route, so it renders WITHOUT this chrome (full-screen wizard).
 */
export function Component() {
  return (
    <div className="flex min-h-svh bg-background text-foreground">
      <SukoonSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <SukoonHeader />
        <main className="flex-1 px-4 pb-24 pt-5 sm:px-6 sm:pb-8 md:pb-8">
          <SukoonBetaBanner />
          <Outlet />
          <NotTherapyFooter className="mt-10" />
        </main>
      </div>
      <SukoonBottomNav />
      {/* One paywall interstitial for the whole module (chat cap, reflections,
          premium journeys, insights) — opened via useSukoonPaywallStore. */}
      <SukoonPaywall />
    </div>
  );
}
