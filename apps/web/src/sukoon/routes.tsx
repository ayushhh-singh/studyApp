import type { RouteObject } from "react-router";

/**
 * The five app tabs, lazy-loaded per page (same convention as router.tsx). They
 * render inside shell.tsx's nav chrome, one level under the root layout.
 */
const sukoonAppRoutes: RouteObject[] = [
  { index: true, lazy: () => import("@/sukoon/pages/home") },
  { path: "saathi", lazy: () => import("@/sukoon/pages/saathi") },
  { path: "journal", lazy: () => import("@/sukoon/pages/journal") },
  { path: "tools", lazy: () => import("@/sukoon/pages/tools") },
  { path: "you", lazy: () => import("@/sukoon/pages/you") },
];

/**
 * Builds the Sukoon route subtree at an arbitrary mount path — "sukoon" when
 * nested under /:locale (integrated), or "/" when it IS the router root
 * (standalone). Two layers:
 *   - root.tsx  — the `.sukoon` theme + night mode + onboarding gate, wrapping
 *     EVERYTHING so onboarding is themed too.
 *   - onboarding — a full-screen sibling of the shell (no nav chrome).
 *   - shell.tsx — the sidebar/bottom-nav chrome, wrapping the five app tabs.
 * All internal nav is route-relative (sukoon/lib/nav.ts), so this works
 * unchanged at either mount point.
 */
export function createSukoonRoute(path: string): RouteObject {
  return {
    path,
    lazy: () => import("@/sukoon/root"),
    children: [
      { path: "onboarding", lazy: () => import("@/sukoon/pages/onboarding") },
      {
        lazy: () => import("@/sukoon/shell"),
        children: sukoonAppRoutes,
      },
    ],
  };
}
