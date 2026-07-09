import { Outlet, useMatches } from "react-router";
import { useTranslation } from "react-i18next";
import { Sidebar } from "@/components/app-shell/sidebar";
import { TopBar } from "@/components/app-shell/top-bar";
import { BottomTabBar } from "@/components/app-shell/bottom-tab-bar";
import { CommandPalette } from "@/components/ui-x/command-palette";
import { MilestoneToaster } from "@/components/app-shell/milestone-toaster";
import { PwaInstallBanner } from "@/components/app-shell/pwa-install-banner";
import { FloatingMentorButton } from "@/components/mentor/floating-mentor-button";
import { PaywallModal } from "@/components/billing/paywall-modal";
import { useLocale } from "@/hooks/use-locale";
import { usePushNavigation } from "@/hooks/use-push-navigation";

interface RouteHandle {
  titleKey?: string;
  /** A raw bilingual title for routes without a messages/*.json key (e.g. billing). */
  titleI18n?: { en: string; hi: string };
}

export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const matches = useMatches();
  const activeHandle = [...matches]
    .reverse()
    .map((match) => match.handle as RouteHandle | undefined)
    .find((handle) => handle?.titleKey || handle?.titleI18n);
  const title = activeHandle?.titleI18n
    ? activeHandle.titleI18n[locale]
    : t(activeHandle?.titleKey ?? "Nav.dashboard");

  usePushNavigation();

  return (
    <div className="flex min-h-svh bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar title={title} />
        <main className="flex-1 px-4 pb-24 pt-4 sm:px-6 sm:pb-8 md:pb-8">
          <PwaInstallBanner />
          <Outlet />
        </main>
      </div>
      <BottomTabBar />
      <CommandPalette />
      <MilestoneToaster />
      <FloatingMentorButton />
      <PaywallModal />
    </div>
  );
}
