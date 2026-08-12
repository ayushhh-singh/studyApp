import { Link, NavLink, type NavLinkRenderProps } from "react-router";
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
      {/* h-14 matches TopBar exactly, so the sidebar's brand block and the top
          bar read as one continuous header band across the top of the app
          rather than two rows at slightly different heights. */}
      <div className="flex h-14 shrink-0 items-center gap-2 px-2">
        {/* BrandMark always renders "Neev" in Latin — matches landing/auth/
            onboarding/pricing, unlike the old hardcoded Devanagari literal that
            ignored the active locale. Wrapped in a Link to the public landing
            page (the bare locale root) — same destination marketing-header/
            footer already use for their own BrandMark, even from inside the
            authenticated app shell. */}
        <Link to={`/${locale}`} aria-label={t("Landing.brand")} className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring">
          <BrandMark />
        </Link>
      </div>
      <div className="flex flex-1 flex-col gap-1">
        {navItems.map((item) => (
          // The active marker is a GOLD leading bar, not a blue fill: every
          // NAVIGATION panel in docs/design/reference-3 marks the current item
          // with a gold rule in BOTH themes (a gold underline under the label
          // in the horizontal nav; here it runs vertically down the item's
          // leading edge, which is the same idea rotated for a sidebar).
          // Gold is one constant value across themes, so this reads identically
          // in light and dark. The flagship keeps a marigold TINT behind it so
          // it still stands out when it isn't the active item.
          <NavLink
            key={item.id}
            to={`/${locale}/${item.to}`}
            className={({ isActive }: NavLinkRenderProps) =>
              cn(
                "relative flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                "before:absolute before:inset-y-1.5 before:start-0 before:w-0.5 before:rounded-full before:bg-transparent",
                item.flagship && !isActive && "bg-marigold/10",
                isActive && "bg-sidebar-accent font-semibold text-sidebar-accent-foreground before:bg-marigold",
              )
            }
          >
            {({ isActive }: NavLinkRenderProps) => (
              <>
                <item.icon
                  className={cn("size-4", isActive ? "text-marigold-foreground" : item.flagship && "text-marigold-foreground")}
                  aria-hidden
                />
                {t(item.labelKey)}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
