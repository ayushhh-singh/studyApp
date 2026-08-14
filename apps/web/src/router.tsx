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
      { path: "auth/reset", lazy: () => import("@/routes/auth-reset") },
      // Public marketing page — pricing must be reachable signed-out (and is
      // reviewed as such by Razorpay's live-mode approval).
      { path: "pricing", lazy: () => import("@/routes/pricing") },
      // Public: free study material (NCERT, government sources) + what we have
      // already written. Public for the same reason /pricing is — it is a
      // reason to sign up, so it must be reachable and indexable before you do.
      // Renders its own marketing chrome for everyone, /pricing's precedent.
      { path: "resources", lazy: () => import("@/routes/resources") },
      // Public marketing pages — one dedicated, indexable SEO page per
      // flagship feature, plus a hub linking to all of them. See lib/features.ts
      // for the feature list; feature-detail's own loader 404s an unknown slug.
      { path: "features", lazy: () => import("@/routes/features-hub") },
      { path: "features/:slug", lazy: () => import("@/routes/feature-detail") },
      // Public marketing pages — trust/accuracy story and support surfaces,
      // reachable signed-out from the landing/app-shell footer.
      { path: "about", lazy: () => import("@/routes/about") },
      { path: "faq", lazy: () => import("@/routes/faq") },
      { path: "contact", lazy: () => import("@/routes/contact") },
      // Legal pages — public, footer-linked; required for Razorpay live-mode review.
      { path: "terms", lazy: () => import("@/routes/terms") },
      { path: "privacy", lazy: () => import("@/routes/privacy") },
      { path: "refund", lazy: () => import("@/routes/refund") },
      // Everything below requires a signed-in session (RequireAuth also gates
      // the onboarding wizard: unfinished onboarding is redirected to it).
      {
        lazy: () => import("@/routes/require-auth"),
        children: [
          { path: "onboarding", lazy: () => import("@/routes/onboarding") },
          // The 5-layer tour's welcome moment — 2-3 skippable value-prop
          // screens shown exactly once, between onboarding and the Dashboard.
          { path: "welcome", lazy: () => import("@/routes/welcome") },
          {
            lazy: () => import("@/routes/app-shell"),
            children: [
              { path: "dashboard", lazy: () => import("@/routes/dashboard") },
              // The tour's permanent, always-findable discovery surface (layer 5).
              { path: "explore", lazy: () => import("@/routes/explore") },
              { path: "learn", lazy: () => import("@/routes/learn") },
              // Static `resources` outranks the sibling `learn/:paperCode`
              // dynamic segment, so it is matched first. Verified in-browser.
              { path: "learn/resources", lazy: () => import("@/routes/learn-resources") },
              { path: "learn/:paperCode", lazy: () => import("@/routes/learn-paper") },
              { path: "learn/:paperCode/trends", lazy: () => import("@/routes/learn-trends") },
              { path: "learn/:paperCode/:nodeId", lazy: () => import("@/routes/learn-node") },
              { path: "practice", lazy: () => import("@/routes/practice") },
              { path: "pyq-archive", lazy: () => import("@/routes/pyq-archive") },
              { path: "test-series", lazy: () => import("@/routes/test-series") },
              { path: "test-series/:slug", lazy: () => import("@/routes/test-series-detail") },
              { path: "scoreboard", lazy: () => import("@/routes/scoreboard") },
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
              {
                path: "answers/session/:sessionId/result",
                lazy: () => import("@/routes/answers-session-result"),
              },
              { path: "current-affairs", lazy: () => import("@/routes/current-affairs") },
              { path: "doubts", lazy: () => import("@/routes/doubts") },
          // A specific conversation gets its own URL — bookmarkable, survives a
          // refresh, and behaves correctly with browser back/forward, unlike
          // the previous local-component-state thread selection.
          { path: "doubts/:threadId", lazy: () => import("@/routes/doubts") },
              { path: "magazine", lazy: () => import("@/routes/magazine-index") },
              // Personal study material saved from a mentor answer ("My notes").
              { path: "my-notes", lazy: () => import("@/routes/my-notes") },
              { path: "my-notes/:id", lazy: () => import("@/routes/my-note") },
              { path: "revision", lazy: () => import("@/routes/revision") },
              { path: "community", lazy: () => import("@/routes/community") },
              { path: "community/shared-answers", lazy: () => import("@/routes/community-shared-answers") },
              { path: "community/shared-answers/:id", lazy: () => import("@/routes/community-shared-answer") },
              { path: "community/thread/:threadId", lazy: () => import("@/routes/community-thread") },
              { path: "review", lazy: () => import("@/routes/review") },
              { path: "admin-users", lazy: () => import("@/routes/admin-users") },
              // Built but hidden: reachable by URL, not linked in nav (see leaderboard.tsx).
              { path: "leaderboard", lazy: () => import("@/routes/leaderboard") },
              { path: "profile", lazy: () => import("@/routes/profile") },
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
          // Same rationale as the MCQ test player — a distraction-free
          // full-screen timed session, not the normal app-shell chrome.
          { path: "answers/session/:testId", lazy: () => import("@/routes/answers-session") },
          // Full-screen CSAT Time Attack (own chrome, instant feedback + big timer).
          { path: "practice/time-attack", lazy: () => import("@/routes/practice-time-attack") },
          // Full-screen Ghost Battle — replay a completed attempt racing past-you.
          { path: "practice/ghost/:attemptId", lazy: () => import("@/routes/practice-ghost") },
          // Same rationale as the test player — a focused full-screen review flow.
          { path: "revision/session", lazy: () => import("@/routes/revision-session") },
          // A whole past paper laid out for print-to-PDF. Outside app-shell for
          // the same reason the magazine editions below are: printing must not
          // carry the sidebar/tab-bar chrome.
          { path: "pyq-archive/print", lazy: () => import("@/routes/pyq-paper-print") },
          // The magazine editions are print-styled documents (own header +
          // print button, no app chrome) so print-to-PDF is clean. The
          // month page itself is a lightweight edition picker (two cards).
          { path: "magazine/:month", lazy: () => import("@/routes/magazine-month") },
          { path: "magazine/:month/prelims", lazy: () => import("@/routes/magazine-prelims") },
          { path: "magazine/:month/mains", lazy: () => import("@/routes/magazine-mains") },
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
