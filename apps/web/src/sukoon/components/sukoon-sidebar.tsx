import { NavLink, type NavLinkRenderProps } from "react-router";
import { SUKOON_NAV_ITEMS } from "@/sukoon/lib/nav";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { cn } from "@/lib/utils";

/** Desktop-only sidebar — Sukoon's own, deliberately not Neev's Sidebar
 *  (components/app-shell/sidebar.tsx), which hardcodes Neev's NAV_ITEMS. */
export function SukoonSidebar() {
  const { t } = useSukoonLanguage();

  return (
    <nav
      aria-label={t("Sukoon.navLabel")}
      className="hidden w-56 shrink-0 flex-col gap-1 overflow-y-auto border-r border-sidebar-border bg-sidebar p-3 md:sticky md:top-0 md:flex md:h-svh"
    >
      <div className="flex flex-1 flex-col gap-1 pt-2">
        {SUKOON_NAV_ITEMS.map((item) => (
          <NavLink
            key={item.id}
            to={item.to}
            end={item.end}
            className={({ isActive }: NavLinkRenderProps) =>
              cn(
                "flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium text-sidebar-foreground/80 transition-colors duration-300 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                isActive && "bg-sidebar-accent text-sidebar-accent-foreground",
              )
            }
          >
            <item.icon className="size-4" aria-hidden />
            {t(item.labelKey)}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
