import { createBrowserRouter, redirect } from "react-router";
import { DEFAULT_LOCALE } from "@/lib/locale";
import { Component as AppErrorBoundary } from "@/components/app-shell/app-error-boundary";

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
    ErrorBoundary: AppErrorBoundary,
  },
  {
    path: "/:locale",
    lazy: () => import("@/routes/locale-layout"),
    HydrateFallback: RedirectPending,
    // Catches: unmatched sub-paths (a genuine 404, e.g. /en/nonexistent),
    // every loader's thrown errors, and every render error anywhere in the
    // locale subtree that isn't caught by a more specific boundary.
    ErrorBoundary: AppErrorBoundary,
    children: [
      // Public marketing landing.
      { index: true, lazy: () => import("@/routes/landing") },
      // Public auth surfaces.
      { path: "auth", lazy: () => import("@/routes/auth") },
      { path: "auth/callback", lazy: () => import("@/routes/auth-callback") },
      // Everything below requires a signed-in session (RequireAuth also gates
      // the onboarding wizard: unfinished onboarding is redirected to it).
      {
        lazy: () => import("@/routes/require-auth"),
        children: [
          { path: "onboarding", lazy: () => import("@/routes/onboarding") },
          {
            lazy: () => import("@/routes/app-shell"),
            children: [
              { path: "dashboard", lazy: () => import("@/routes/dashboard") },
              { path: "learn", lazy: () => import("@/routes/learn") },
              { path: "learn/:paperCode", lazy: () => import("@/routes/learn-paper") },
              { path: "learn/:paperCode/trends", lazy: () => import("@/routes/learn-trends") },
              { path: "learn/:paperCode/:nodeId", lazy: () => import("@/routes/learn-node") },
              { path: "practice", lazy: () => import("@/routes/practice") },
              {
                path: "practice/attempt/:attemptId/result",
                lazy: () => import("@/routes/practice-attempt-result"),
              },
              { path: "answers", lazy: () => import("@/routes/answers") },
              { path: "answers/write", lazy: () => import("@/routes/answers-write") },
              {
                path: "answers/confirm/:submissionId",
                lazy: () => import("@/routes/answers-confirm"),
              },
              {
                path: "answers/evaluation/:submissionId",
                lazy: () => import("@/routes/answers-evaluation"),
              },
              { path: "current-affairs", lazy: () => import("@/routes/current-affairs") },
              { path: "doubts", lazy: () => import("@/routes/doubts") },
              { path: "magazine", lazy: () => import("@/routes/magazine-index") },
              { path: "revision", lazy: () => import("@/routes/revision") },
              { path: "community", lazy: () => import("@/routes/community") },
              { path: "community/shared-answers", lazy: () => import("@/routes/community-shared-answers") },
              { path: "community/shared-answers/:id", lazy: () => import("@/routes/community-shared-answer") },
              { path: "community/thread/:threadId", lazy: () => import("@/routes/community-thread") },
              { path: "review", lazy: () => import("@/routes/review") },
              // Built but hidden: reachable by URL, not linked in nav (see leaderboard.tsx).
              { path: "leaderboard", lazy: () => import("@/routes/leaderboard") },
              { path: "profile", lazy: () => import("@/routes/profile") },
              { path: "pricing", lazy: () => import("@/routes/pricing") },
              // A multi-step flow (write -> score) but not a distraction-mode
              // full-screen experience, so it stays inside app-shell like the
              // rest of Profile — just its own route for clean back-navigation.
              { path: "profile/drill", lazy: () => import("@/routes/profile-drill") },
            ],
          },
          // Outside app-shell, deliberately: the test player is a distraction-free
          // full-screen experience with its own minimal header, not the normal
          // sidebar/bottom-tab/topbar chrome.
          { path: "practice/test/:testId", lazy: () => import("@/routes/practice-test") },
          // Full-screen CSAT Time Attack (own chrome, instant feedback + big timer).
          { path: "practice/time-attack", lazy: () => import("@/routes/practice-time-attack") },
          // Full-screen Ghost Battle — replay a completed attempt racing past-you.
          { path: "practice/ghost/:attemptId", lazy: () => import("@/routes/practice-ghost") },
          // Same rationale as the test player — a focused full-screen review flow.
          { path: "revision/session", lazy: () => import("@/routes/revision-session") },
          // The monthly magazine is a print-styled document (own header + print
          // button, no app chrome) so print-to-PDF is clean.
          { path: "magazine/:month", lazy: () => import("@/routes/magazine") },
        ],
      },
      // A path with a VALID locale prefix but no matching child (e.g.
      // /en/nonexistent) previously fell through to the top-level "*" route
      // below, which silently redirects to the landing page — no 404, no
      // signal anything was wrong. This explicit wildcard makes /:locale
      // itself the match, so its ErrorBoundary (AppErrorBoundary) renders a
      // real "page not found" instead. The top-level "*" route still handles
      // paths with no locale segment at all (e.g. bare "/xyz").
      {
        path: "*",
        loader: () => {
          throw new Response("Not Found", { status: 404 });
        },
        Component: RedirectPending,
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
