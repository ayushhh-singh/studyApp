import type { RouteObject } from "react-router";

/**
 * The five app tabs, lazy-loaded per page (same convention as router.tsx). They
 * render inside shell.tsx's nav chrome, one level under the root layout.
 */
const sukoonAppRoutes: RouteObject[] = [
  { index: true, lazy: () => import("@/sukoon/pages/home") },
  { path: "saathi", lazy: () => import("@/sukoon/pages/saathi") },
  { path: "mood", lazy: () => import("@/sukoon/pages/mood") },
  { path: "journal", lazy: () => import("@/sukoon/pages/journal") },
  // Static segments before the :entryId param so they aren't captured as ids
  // (React Router ranks static > dynamic, but keep them ordered for clarity).
  { path: "journal/new", lazy: () => import("@/sukoon/pages/journal-editor") },
  { path: "journal/:entryId", lazy: () => import("@/sukoon/pages/journal-entry") },
  { path: "journal/:entryId/edit", lazy: () => import("@/sukoon/pages/journal-editor") },
  { path: "tools", lazy: () => import("@/sukoon/pages/tools") },
  { path: "tools/breathing/:exerciseId", lazy: () => import("@/sukoon/pages/tools-breathing") },
  { path: "tools/grounding/:exerciseId", lazy: () => import("@/sukoon/pages/tools-grounding") },
  { path: "tools/pmr/:exerciseId", lazy: () => import("@/sukoon/pages/tools-pmr") },
  { path: "tools/meditation/:exerciseId", lazy: () => import("@/sukoon/pages/tools-meditation") },
  { path: "tools/timer/:exerciseId", lazy: () => import("@/sukoon/pages/tools-timer") },
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
      // Hidden dev-only crisis probe (blueprint F3) — present only in dev
      // builds; the matching /dev/crisis/assess API route is likewise gated. A
      // full-screen sibling of the shell (no nav chrome), like onboarding.
      ...(import.meta.env.DEV
        ? [{ path: "dev/crisis", lazy: () => import("@/sukoon/pages/dev-crisis") }]
        : []),
      {
        lazy: () => import("@/sukoon/shell"),
        children: sukoonAppRoutes,
      },
    ],
  };
}
