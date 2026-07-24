import type { RouteObject } from "react-router";

/**
 * The five tabs, lazy-loaded per page (same convention as router.tsx). Kept
 * separate from the shell's own path so this exact array is reusable at two
 * different mount points: /:locale/sukoon/* (integrated) and /* (standalone,
 * VITE_APP=sukoon) — see createSukoonRoute below and router.tsx.
 */
const sukoonChildRoutes: RouteObject[] = [
  { index: true, lazy: () => import("@/sukoon/pages/home") },
  { path: "saathi", lazy: () => import("@/sukoon/pages/saathi") },
  { path: "journal", lazy: () => import("@/sukoon/pages/journal") },
  { path: "tools", lazy: () => import("@/sukoon/pages/tools") },
  { path: "you", lazy: () => import("@/sukoon/pages/you") },
];

/**
 * Builds the Sukoon layout route at an arbitrary mount path — "sukoon" when
 * nested under /:locale (integrated), or "/" when it IS the router root
 * (standalone). All internal nav links are route-relative (sukoon/lib/nav.ts),
 * so the same shell + child routes work unchanged at either mount point.
 */
export function createSukoonRoute(path: string): RouteObject {
  return {
    path,
    lazy: () => import("@/sukoon/shell"),
    children: sukoonChildRoutes,
  };
}
