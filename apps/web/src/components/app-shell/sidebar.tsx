import { NavLink } from "react-router";
import { useTranslation } from "react-i18next";
import { visibleNav } from "@/lib/nav";
import { useLocale } from "@/hooks/use-locale";
import { useAdminStatus } from "@/hooks/use-review";
import { BrandMark } from "@/components/marketing/brand-mark";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { data: admin } = useAdminStatus();
  const navItems = visibleNav(admin?.admin_mode ?? false);

  return (
    <nav
      aria-label={t("Nav.sectionsLabel")}
      // sticky top-0 h-svh: the app shell (app-shell.tsx) has no height cap of
      // its own, so the page/body is what scrolls — without this the sidebar
      // was just a plain flex child that scrolled away with the rest of the
      // page instead of staying pinned like TopBar. overflow-y-auto is a
      // safety valve if the nav item list itself (plus admin-only items) ever
      // exceeds a short viewport's height.
      className="hidden w-60 shrink-0 flex-col gap-1 overflow-y-auto border-r border-sidebar-border bg-sidebar p-3 md:sticky md:top-0 md:flex md:h-svh"
    >
      <div className="flex items-center gap-2 px-2 py-3">
        {/* BrandMark always renders "Neev" in Latin — matches landing/auth/
            onboarding/pricing, unlike the old hardcoded Devanagari literal that
            ignored the active locale. */}
        <BrandMark />
      </div>
      <div className="flex flex-1 flex-col gap-1">
        {navItems.map((item) => (
          <NavLink
            key={item.id}
            to={`/${locale}/${item.to}`}
            className={({ isActive }) =>
              cn(
                "flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                isActive &&
                  (item.flagship
                    ? "bg-marigold/15 text-marigold-foreground"
                    : "bg-sidebar-accent text-sidebar-accent-foreground"),
              )
            }
          >
            <item.icon className={cn("size-4", item.flagship && "text-marigold")} aria-hidden />
            {t(item.labelKey)}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
