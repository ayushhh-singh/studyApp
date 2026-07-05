import { createBrowserRouter, redirect } from "react-router";
import { DEFAULT_LOCALE } from "@/lib/locale";

function RedirectPending() {
  return null;
}

export const router = createBrowserRouter([
  {
    path: "/",
    loader: () => redirect(`/${DEFAULT_LOCALE}`),
    Component: RedirectPending,
    HydrateFallback: RedirectPending,
  },
  {
    path: "/:locale",
    lazy: () => import("@/routes/locale-layout"),
    children: [
      {
        index: true,
        lazy: () => import("@/routes/landing"),
      },
    ],
  },
  {
    path: "*",
    loader: () => redirect(`/${DEFAULT_LOCALE}`),
    Component: RedirectPending,
    HydrateFallback: RedirectPending,
  },
]);
