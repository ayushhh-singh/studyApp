import { NavLink, type NavLinkRenderProps } from "react-router";
import { SUKOON_NAV_ITEMS } from "@/sukoon/lib/nav";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { cn } from "@/lib/utils";

/** Mobile-only bottom tab bar — Sukoon's own (all 5 tabs fit, no "More" sheet needed). */
export function SukoonBottomNav() {
  const { t } = useSukoonLanguage();

  return (
    <nav
      aria-label={t("Sukoon.navLabel")}
      className="fixed inset-x-0 bottom-0 z-30 flex h-16 items-stretch border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {SUKOON_NAV_ITEMS.map((item) => (
        <NavLink
          key={item.id}
          to={item.to}
          end={item.end}
          className={({ isActive }: NavLinkRenderProps) =>
            cn(
              "flex min-w-11 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              isActive && "text-primary",
            )
          }
        >
          <item.icon className="size-5" aria-hidden />
          {t(item.labelKey)}
        </NavLink>
      ))}
    </nav>
  );
}
