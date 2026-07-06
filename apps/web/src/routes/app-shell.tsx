import { Outlet, useMatches } from "react-router";
import { useTranslation } from "react-i18next";
import { Sidebar } from "@/components/app-shell/sidebar";
import { TopBar } from "@/components/app-shell/top-bar";
import { BottomTabBar } from "@/components/app-shell/bottom-tab-bar";
import { CommandPalette } from "@/components/ui-x/command-palette";
import { MilestoneToaster } from "@/components/app-shell/milestone-toaster";

interface RouteHandle {
  titleKey?: string;
}

export function Component() {
  const { t } = useTranslation();
  const matches = useMatches();
  const activeHandle = [...matches]
    .reverse()
    .map((match) => match.handle as RouteHandle | undefined)
    .find((handle) => handle?.titleKey);
  const title = t(activeHandle?.titleKey ?? "Nav.dashboard");

  return (
    <div className="flex min-h-svh bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar title={title} />
        <main className="flex-1 px-4 pb-24 pt-4 sm:px-6 sm:pb-8 md:pb-8">
          <Outlet />
        </main>
      </div>
      <BottomTabBar />
      <CommandPalette />
      <MilestoneToaster />
    </div>
  );
}
