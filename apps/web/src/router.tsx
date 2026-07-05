import { createBrowserRouter, redirect } from "react-router";
import { DEFAULT_LOCALE } from "@/lib/locale";

function RedirectPending() {
  return null;
}

export const router = createBrowserRouter([
  {
    path: "/",
    loader: ({ request }) => {
      const { search, hash } = new URL(request.url);
      return redirect(`/${DEFAULT_LOCALE}${search}${hash}`);
    },
    Component: RedirectPending,
    HydrateFallback: RedirectPending,
  },
  {
    path: "/:locale",
    lazy: () => import("@/routes/locale-layout"),
    HydrateFallback: RedirectPending,
    children: [
      {
        index: true,
        loader: ({ params }) => redirect(`/${params.locale}/dashboard`),
        Component: RedirectPending,
      },
      {
        lazy: () => import("@/routes/app-shell"),
        children: [
          { path: "dashboard", lazy: () => import("@/routes/dashboard") },
          { path: "learn", lazy: () => import("@/routes/learn") },
          { path: "practice", lazy: () => import("@/routes/practice") },
          { path: "answers", lazy: () => import("@/routes/answers") },
          { path: "current-affairs", lazy: () => import("@/routes/current-affairs") },
          { path: "revision", lazy: () => import("@/routes/revision") },
          { path: "profile", lazy: () => import("@/routes/profile") },
        ],
      },
    ],
  },
  {
    path: "*",
    loader: () => redirect(`/${DEFAULT_LOCALE}/dashboard`),
    Component: RedirectPending,
    HydrateFallback: RedirectPending,
  },
]);
