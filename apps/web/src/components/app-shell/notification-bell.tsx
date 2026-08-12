import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Bell, CheckCheck, Flame, Layers, Sparkles, X } from "lucide-react";
import type { NotificationType } from "@neev/shared";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui-x/sheet";
import { useNotifications, useNotificationAction, useClearNotifications } from "@/hooks/use-notifications";
import { useLocale } from "@/hooks/use-locale";

const ICONS: Record<NotificationType, typeof Bell> = {
  quiz_ready: Sparkles,
  streak_at_risk: Flame,
  srs_due: Layers,
};

/** Per-type tile tint. Always the paired -foreground for the glyph — raw
 *  --marigold measures 1.6:1 and would be a decorative smudge, not an icon. */
const TINTS: Record<NotificationType, string> = {
  quiz_ready: "bg-primary/10 text-primary",
  streak_at_risk: "bg-marigold/20 text-marigold-foreground",
  srs_due: "bg-primary/10 text-primary",
};

export function NotificationBell() {
  const { t } = useTranslation();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const { data } = useNotifications();
  const action = useNotificationAction();
  const clearAll = useClearNotifications();
  const items = data?.items ?? [];
  const unread = data?.unread_count ?? 0;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="relative"
        aria-label={t("Notifications.title")}
        onClick={() => setOpen(true)}
      >
        <Bell className="size-4" aria-hidden />
        {unread > 0 && (
          <span className="absolute right-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-4 text-white dark:text-brand-navy">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" title={t("Notifications.title")} className="w-full overflow-y-auto sm:w-[380px]">
          {items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("Notifications.empty")}</p>
          ) : (
            <>
              <div className="mb-2 flex justify-end">
                {/* Default size, not `sm`: a 32px control is under the design
                    system's tap-target floor, and this repo already reverted
                    exactly that on the revision Quick-add buttons. */}
                <Button
                  type="button"
                  variant="ghost"
                  disabled={clearAll.isPending}
                  onClick={() => clearAll.mutate()}
                >
                  <CheckCheck className="size-3.5" aria-hidden />
                  {t("Notifications.clearAll")}
                </Button>
              </div>
              <ul className="flex flex-col gap-2">
                {items.map((n) => {
                  // Fallbacks, not bare lookups. Both maps are exhaustive at
                  // compile time, but the TYPE comes off the wire — a
                  // notification_type added server-side and deployed before the
                  // web bundle would make `Icon` undefined, and rendering an
                  // undefined component throws and takes the whole panel down.
                  // (Pre-existing for ICONS; TINTS inherits the same guard.)
                  const Icon = ICONS[n.type] ?? Bell;
                  const tint = TINTS[n.type] ?? "bg-primary/10 text-primary";
                  const body = (
                    <div className="flex gap-3">
                      {/* Rounded square and typed tint, per the reference's
                          list rows — a streak at risk is not the same kind of
                          message as a quiz being ready, and the row said so
                          only in its wording. marigold-FOREGROUND for the icon:
                          raw --marigold is 1.6:1 on this surface. */}
                      <span className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl ${tint}`}>
                        <Icon className="size-4.5" aria-hidden />
                      </span>
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-sm font-medium">{n.title_i18n[locale]}</span>
                        <span className="text-xs text-muted-foreground">{n.body_i18n[locale]}</span>
                      </div>
                    </div>
                  );
                  return (
                    <li key={n.id} className="flex items-start gap-1 rounded-xl border border-border bg-card p-3">
                      {n.link ? (
                        <Link
                          to={`/${locale}${n.link}`}
                          className="min-w-0 flex-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() => {
                            action.mutate({ id: n.id, action: "read" });
                            setOpen(false);
                          }}
                        >
                          {body}
                        </Link>
                      ) : (
                        <div className="min-w-0 flex-1">{body}</div>
                      )}
                      <button
                        type="button"
                        aria-label={t("Notifications.dismiss")}
                        // size-9 for the same reason the Clear all button above
                        // is default-size: 28px is under the tap-target floor,
                        // and this one is tapped far more often.
                        className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => action.mutate({ id: n.id, action: "dismiss" })}
                      >
                        <X className="size-3.5" aria-hidden />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
