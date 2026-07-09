import { useState } from "react";
import { NavLink, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { MoreHorizontal } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui-x/sheet";
import { useLocale } from "@/hooks/use-locale";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useAdminStatus } from "@/hooks/use-review";
import { useSrsStats } from "@/hooks/use-srs";
import { MOBILE_MORE_NAV, MOBILE_PRIMARY_NAV } from "@/lib/nav";
import { cn } from "@/lib/utils";

// Same badge convention as NotificationBell (components/app-shell/notification-bell.tsx)
// — a small coral count pill, capped at "9+". Only Revision has a genuine,
// already-computed "needs attention" number (SRS due count); Learn/Current
// Affairs/Mentor/Community have no per-user "unread"/"new" tracking in the
// schema today, so they intentionally don't get a fabricated badge.
function TabBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="absolute right-1.5 top-1 flex min-w-4 items-center justify-center rounded-full bg-coral px-1 text-[10px] font-bold leading-4 text-white">
      {count > 9 ? "9+" : count}
    </span>
  );
}

export function BottomTabBar() {
  const { t } = useTranslation();
  const locale = useLocale();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const { data: admin } = useAdminStatus();
  // This component is always mounted (app-shell.tsx renders it unconditionally
  // and relies on `md:hidden` to hide it visually on desktop) — without this
  // gate, every authenticated page load/navigation on DESKTOP would fire a
  // GET /srs/stats purely to power a badge that's never actually visible
  // there. matches Tailwind's own `md` breakpoint (768px) exactly.
  const isMobile = useMediaQuery("(max-width: 767px)");
  const { data: srsStats } = useSrsStats({ enabled: isMobile });
  const moreItems = MOBILE_MORE_NAV.filter((item) => !item.adminOnly || admin?.admin_mode);

  const moreActive = moreItems.some((item) => location.pathname.includes(`/${item.to}`));

  return (
    <nav
      aria-label={t("Nav.sectionsLabel")}
      className="fixed inset-x-0 bottom-0 z-30 flex h-16 items-stretch border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {MOBILE_PRIMARY_NAV.map((item) => {
        const dueCount = item.id === "revision" ? (srsStats?.due_today ?? 0) : 0;
        return (
          <NavLink
            key={item.id}
            to={`/${locale}/${item.to}`}
            aria-label={dueCount > 0 ? `${t(item.labelKey)} — ${t("Dashboard.guidedSrsDue", { n: dueCount })}` : undefined}
            className={({ isActive }) =>
              cn(
                "relative flex min-w-11 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                isActive && (item.flagship ? "text-marigold" : "text-primary"),
              )
            }
          >
            <span className="relative">
              <item.icon className="size-5" aria-hidden />
              <TabBadge count={dueCount} />
            </span>
            {t(item.labelKey)}
          </NavLink>
        );
      })}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex min-w-11 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              moreActive && "text-primary",
            )}
          >
            <MoreHorizontal className="size-5" aria-hidden />
            {t("Nav.more")}
          </button>
        </SheetTrigger>
        <SheetContent side="bottom" title={t("Nav.more")}>
          <div className="flex flex-col gap-1">
            {moreItems.map((item) => (
              <NavLink
                key={item.id}
                to={`/${locale}/${item.to}`}
                onClick={() => setMoreOpen(false)}
                className={({ isActive }) =>
                  cn(
                    "flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium text-foreground/80 hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isActive && "bg-accent text-accent-foreground",
                  )
                }
              >
                <item.icon className="size-4" aria-hidden />
                {t(item.labelKey)}
              </NavLink>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </nav>
  );
}
