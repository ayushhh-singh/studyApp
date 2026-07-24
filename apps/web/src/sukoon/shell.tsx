import { useEffect } from "react";
import { Outlet } from "react-router";
import "@/sukoon/theme/index.css";
import { SukoonHeader } from "@/sukoon/components/sukoon-header";
import { SukoonSidebar } from "@/sukoon/components/sukoon-sidebar";
import { SukoonBottomNav } from "@/sukoon/components/sukoon-bottom-nav";
import { SukoonDisclaimer } from "@/sukoon/components/sukoon-disclaimer";
import { useSukoonNightMode } from "@/sukoon/lib/use-sukoon-night-mode";
import { cn } from "@/lib/utils";

// index.html's static <title>/theme-color/favicon are Neev's — vite-plugin-pwa
// only swaps the manifest content per build (vite.config.ts), not the HTML
// template. In a standalone build there's no other Sukoon page that would
// ever overwrite these back to Neev's, so it's safe to set them once here.
const IS_STANDALONE = import.meta.env.VITE_APP === "sukoon";

/**
 * Sukoon's own shell — sidebar on desktop, bottom-nav on mobile, deliberately
 * NOT Neev's app-shell.tsx (which renders Neev's Sidebar/BottomTabBar/TopBar
 * and would double up chrome). The `.sukoon` class scopes the whole subtree
 * to Sukoon's theme tokens (theme/index.css); `sukoon-dark` layers Sukoon's
 * own 9pm–6am auto-dark schedule on top, independent of Neev's manual toggle.
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
    <div className={cn("sukoon flex min-h-svh bg-background text-foreground", isNight && "sukoon-dark")}>
      <SukoonSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <SukoonHeader />
        <main className="flex-1 px-4 pb-24 pt-5 sm:px-6 sm:pb-8 md:pb-8">
          <Outlet />
          <SukoonDisclaimer />
        </main>
      </div>
      <SukoonBottomNav />
    </div>
  );
}
