import { NavLink } from "react-router";
import { useTranslation } from "react-i18next";
import { NAV_ITEMS } from "@/lib/nav";
import { useLocale } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const { t } = useTranslation();
  const locale = useLocale();

  return (
    <nav
      aria-label={t("Nav.sectionsLabel")}
      className="hidden w-60 shrink-0 flex-col gap-1 border-r border-sidebar-border bg-sidebar p-3 md:flex"
    >
      <div className="flex items-center gap-2 px-2 py-3">
        <span className="font-display text-lg text-sidebar-foreground">प्रयासUP</span>
      </div>
      <div className="flex flex-1 flex-col gap-1">
        {NAV_ITEMS.map((item) => (
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
