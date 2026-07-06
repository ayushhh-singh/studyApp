import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Bell, Flame, Layers, Sparkles, X } from "lucide-react";
import type { NotificationType } from "@prayasup/shared";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui-x/sheet";
import { useNotifications, useNotificationAction } from "@/hooks/use-notifications";
import { useLocale } from "@/hooks/use-locale";

const ICONS: Record<NotificationType, typeof Bell> = {
  quiz_ready: Sparkles,
  streak_at_risk: Flame,
  srs_due: Layers,
};

export function NotificationBell() {
  const { t } = useTranslation();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const { data } = useNotifications();
  const action = useNotificationAction();
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
          <span className="absolute right-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-coral px-1 text-[10px] font-bold leading-4 text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" title={t("Notifications.title")} className="w-full overflow-y-auto sm:w-[380px]">
          {items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("Notifications.empty")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {items.map((n) => {
                const Icon = ICONS[n.type];
                const body = (
                  <div className="flex gap-3">
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-sm font-medium">{n.title_i18n[locale]}</span>
                      <span className="text-xs text-muted-foreground">{n.body_i18n[locale]}</span>
                    </div>
                  </div>
                );
                return (
                  <li key={n.id} className="flex items-start gap-1 rounded-lg border border-border p-2">
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
                      className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => action.mutate({ id: n.id, action: "dismiss" })}
                    >
                      <X className="size-3.5" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
