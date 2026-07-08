import { useEffect } from "react";
import { useNavigate } from "react-router";
import { okResponseSchema, type PushSubscribeBody } from "@prayasup/shared";
import { useLocale } from "@/hooks/use-locale";
import { api } from "@/lib/api";

/**
 * Listens for messages the SW can't act on itself:
 *  - NOTIFICATION_NAVIGATE: notificationclick postMessages the focused/newly-
 *    opened client instead of navigating directly — the SW can't reach
 *    react-router, so it hands the link back to whichever tab is running the app.
 *  - PUSH_SUBSCRIPTION_CHANGED: the browser rotated the push subscription on
 *    its own (see sw.ts's pushsubscriptionchange handler); the SW can't read
 *    the auth token to tell the server itself, so it hands the fresh
 *    subscription to an open tab, which can.
 */
export function usePushNavigation(): void {
  const navigate = useNavigate();
  const locale = useLocale();

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    function onMessage(event: MessageEvent) {
      if (event.data?.type === "NOTIFICATION_NAVIGATE" && typeof event.data.link === "string") {
        navigate(`/${locale}${event.data.link}`);
        return;
      }
      if (event.data?.type === "PUSH_SUBSCRIPTION_CHANGED") {
        const sub = event.data.subscription as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
        if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys.auth) return;
        const body: PushSubscribeBody = {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
          user_agent: navigator.userAgent.slice(0, 300),
        };
        void api.post("/api/v1/push/subscribe", okResponseSchema, body);
      }
    }
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [navigate, locale]);
}
