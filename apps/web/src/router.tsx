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
          { path: "revision", lazy: () => import("@/routes/revision") },
          { path: "review", lazy: () => import("@/routes/review") },
          { path: "profile", lazy: () => import("@/routes/profile") },
        ],
      },
      // Outside app-shell, deliberately: the test player is a distraction-free
      // full-screen experience with its own minimal header, not the normal
      // sidebar/bottom-tab chrome.
      { path: "practice/test/:testId", lazy: () => import("@/routes/practice-test") },
    ],
  },
  {
    path: "*",
    loader: () => redirect(`/${DEFAULT_LOCALE}/dashboard`),
    Component: RedirectPending,
    HydrateFallback: RedirectPending,
  },
]);
