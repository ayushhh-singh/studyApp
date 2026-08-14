import { useState } from "react";
import { NavLink, useLocation, type NavLinkRenderProps } from "react-router";
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
// — a small red count pill (--destructive; white on --coral was 3.7:1),
// capped at "9+". White clears 4.5:1 on the light red but only 3.0:1 on the
// lighter dark-theme one, so dark flips the label to navy (5.6:1) — the same
// pairing components/ui-x/badge.tsx's "hot" variant uses. Only Revision has a genuine,
// already-computed "needs attention" number (SRS due count); Learn/Current
// Affairs/Mentor/Community have no per-user "unread"/"new" tracking in the
// schema today, so they intentionally don't get a fabricated badge.
/**
 * Label sizing for the bar, shared by every tab AND the More button so the six
 * labels stay on one baseline.
 *
 * Both halves exist because the bar went from 5 slots to 6 (Test Series became
 * a primary): English "Dashboard" spilled its box and "Test Series" wrapped to
 * two lines, which shoved that one tab's icon out of line with its neighbours.
 *
 * MEASURED, at semibold — the active state, i.e. the widest a label ever
 * renders — against the slot width the viewport gives (viewport / 6):
 *
 *            worst EN label   320px→53.3   360px→60   390px→65
 *   10px     Test Series 56      clips       fits       fits
 *   11px     Test Series 61      clips       clips      fits
 *
 * Hence the step at 390 rather than 360, and no horizontal padding on the
 * label — 4px of `px-0.5` was itself enough to clip "Test Series" at 390.
 * Hindi is comfortable throughout (its widest is 48px at 11px).
 *
 * `truncate` is the guard, not the mechanism: it forces `white-space: nowrap`,
 * so no label can ever wrap and break the row's alignment again, and it clips
 * with an ellipsis rather than bleeding into the next tab.
 *
 * Verified at 320/360/390/414/430 in both locales, INCLUDING the worst case
 * that a width sweep alone misses — the longest label also being the ACTIVE
 * (semibold) one, which only happens on that tab's own route. Nothing clips at
 * >=360px. At 320px (a 1st-gen SE, below this app's 390px floor) an active
 * "Dashboard"/"Test Series" clips by 2-3px; that is the accepted trade against
 * a sub-10px font or renaming an established tab, and it degrades to an
 * ellipsis with the row still aligned.
 */
const TAB_LABEL_SIZE = "text-[10px] min-[390px]:text-[11px]";
const TAB_LABEL = "w-full truncate text-center";

function TabBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="absolute right-1.5 top-1 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-4 text-white dark:text-brand-navy">
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
          // Active state matches the rest of the chrome: a GOLD rule on the
          // bar's own edge (top, since this bar is anchored to the bottom of
          // the viewport) plus a bolder label — the same marker the sidebar and
          // reference-3's NAVIGATION panels use. The label itself goes to
          // --foreground rather than a colour, because gold text on a light
          // card measures 1.6:1; the gold does the signalling, the weight does
          // the rest.
          <NavLink
            key={item.id}
            to={`/${locale}/${item.to}`}
            aria-label={dueCount > 0 ? `${t(item.labelKey)} — ${t("Dashboard.guidedSrsDue", { n: dueCount })}` : undefined}
            className={({ isActive }: NavLinkRenderProps) =>
              cn(
                "relative flex min-w-11 flex-1 flex-col items-center justify-center gap-1 font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                TAB_LABEL_SIZE,
                "before:absolute before:inset-x-3 before:top-0 before:h-0.5 before:rounded-full before:bg-transparent",
                isActive && "font-semibold text-foreground before:bg-marigold",
              )
            }
          >
            <span className="relative">
              <item.icon className="size-5" aria-hidden />
              <TabBadge count={dueCount} />
            </span>
            <span className={TAB_LABEL}>{t(item.labelKey)}</span>
          </NavLink>
        );
      })}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetTrigger asChild>
          <button
            type="button"
            className={cn(
              "relative flex min-w-11 flex-1 flex-col items-center justify-center gap-1 font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              TAB_LABEL_SIZE,
              "before:absolute before:inset-x-3 before:top-0 before:h-0.5 before:rounded-full before:bg-transparent",
              moreActive && "font-semibold text-foreground before:bg-marigold",
            )}
          >
            <MoreHorizontal className="size-5" aria-hidden />
            <span className={TAB_LABEL}>{t("Nav.more")}</span>
          </button>
        </SheetTrigger>
        <SheetContent side="bottom" title={t("Nav.more")}>
          <div className="flex flex-col gap-1">
            {moreItems.map((item) => (
              <NavLink
                key={item.id}
                to={`/${locale}/${item.to}`}
                onClick={() => setMoreOpen(false)}
                className={({ isActive }: NavLinkRenderProps) =>
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
