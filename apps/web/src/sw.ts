/// <reference lib="webworker" />
import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute, setCatchHandler } from "workbox-routing";
import { NetworkFirst, StaleWhileRevalidate } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { CacheableResponsePlugin } from "workbox-cacheable-response";

declare const self: ServiceWorkerGlobalScope;

// Statically replaced per build (same VITE_APP switch as vite.config.ts /
// router.tsx / shell.tsx) — the SW is built through Vite's own pipeline even
// under injectManifest, so this branch is resolved and dead-code-eliminated
// at build time, not read at runtime.
const IS_SUKOON = import.meta.env.VITE_APP === "sukoon";
const OFFLINE_FALLBACK = IS_SUKOON ? "/sukoon-offline.html" : "/offline.html";
const PUSH_ICON = IS_SUKOON ? "/pwa/sukoon-icon-192.png" : "/pwa/icon-192.png";

cleanupOutdatedCaches();
// self.__WB_MANIFEST is injected at build time (vite-plugin-pwa injectManifest)
// with every hashed build asset — JS/CSS chunks, the Fontsource woff2 files,
// the app icons, index.html, and offline.html.
precacheAndRoute(self.__WB_MANIFEST);

// SPA navigations: try the network first (so a signed-in user always sees
// fresh content when online) but fall back to the precached app shell when
// offline — react-router then renders whatever route-level data IS cached
// (e.g. an already-loaded revision queue), rather than a dead page.
registerRoute(
  new NavigationRoute(
    new NetworkFirst({
      cacheName: "pages",
      networkTimeoutSeconds: 4,
      plugins: [new CacheableResponsePlugin({ statuses: [0, 200] })],
    }),
  ),
);

// Read-mostly catalog GETs (syllabus tree, questions, notes) — safe to serve
// stale-while-revalidate so browsing recently-visited content works offline.
registerRoute(
  ({ url, request }) =>
    request.method === "GET" &&
    (url.pathname.startsWith("/api/v1/syllabus") ||
      url.pathname.startsWith("/api/v1/questions") ||
      url.pathname.startsWith("/api/v1/notes")),
  new StaleWhileRevalidate({
    cacheName: "api-catalog",
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 24 * 60 * 60 }),
    ],
  }),
);

// Last resort: a document request that failed both the network AND the
// "pages" runtime cache (first-ever offline visit before anything else was
// cached) gets the precached app shell, or failing that the static offline
// fallback page.
setCatchHandler(async ({ request }) => {
  if (request.destination === "document") {
    return (await matchPrecache("/index.html")) ?? (await matchPrecache(OFFLINE_FALLBACK)) ?? Response.error();
  }
  return Response.error();
});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload: { title: string; body: string; link: string | null; tag: string };
  try {
    payload = event.data.json();
  } catch {
    return;
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: PUSH_ICON,
      badge: PUSH_ICON,
      tag: payload.tag,
      data: { link: payload.link },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = (event.notification.data as { link?: string } | undefined)?.link ?? "/";
  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = allClients.find((c) => "focus" in c);
      if (existing) {
        existing.postMessage({ type: "NOTIFICATION_NAVIGATE", link });
        return existing.focus();
      }
      return self.clients.openWindow(link);
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

// Browsers occasionally rotate a push subscription's endpoint on their own
// (key rotation, browser-side cleanup) — without this, the old endpoint the
// server has on file silently goes dead and the user stops getting pushes
// with no visible error. The SW can re-subscribe itself but can't read the
// Supabase auth token (it lives in localStorage, which a service worker has
// no access to) to call the authenticated POST /push/subscribe — so it hands
// the fresh subscription to an open tab via postMessage, which DOES have the
// token, to complete the round-trip. If no tab is open when this fires, the
// resubscribe is best-effort and completes silently on the user's next visit
// instead (use-push.ts's status check will show "not subscribed" and the
// soft pre-prompt naturally offers to re-enable).
self.addEventListener("pushsubscriptionchange", (event) => {
  const changeEvent = event as unknown as {
    oldSubscription?: PushSubscription;
    waitUntil: (p: Promise<unknown>) => void;
  };
  changeEvent.waitUntil(
    (async () => {
      const options = changeEvent.oldSubscription?.options;
      if (!options) return;
      const newSubscription = await self.registration.pushManager.subscribe(options);
      const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of allClients) {
        client.postMessage({ type: "PUSH_SUBSCRIPTION_CHANGED", subscription: newSubscription.toJSON() });
      }
    })(),
  );
});
