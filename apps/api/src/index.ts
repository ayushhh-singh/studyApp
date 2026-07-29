import express from "express";
import cors from "cors";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { logger } from "./lib/logger.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { requireAuth } from "./middleware/require-auth.js";
import { healthRouter } from "./routes/health.js";
import { checkMentorCacheHealthAtBoot } from "./services/mentor/cache-health.js";
import { checkExamConfigRegistryAtBoot } from "./lib/exam-config.js";
import { streamRouter } from "./routes/stream.js";
import { syllabusRouter } from "./routes/syllabus.js";
import { questionsRouter } from "./routes/questions.js";
import { questionReportsRouter } from "./routes/question-reports.js";
import { testsRouter } from "./routes/tests.js";
import { attemptsRouter } from "./routes/attempts.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { currentAffairsRouter } from "./routes/current-affairs.js";
import { profileRouter } from "./routes/profile.js";
import { eventsRouter } from "./routes/events.js";
import { srsRouter } from "./routes/srs.js";
import { answersRouter } from "./routes/answers.js";
import { answerSessionsRouter } from "./routes/answer-sessions.js";
import { adminRouter } from "./routes/admin.js";
import { notesRouter } from "./routes/notes.js";
import { userNotesRouter } from "./routes/user-notes.js";
import { magazineRouter } from "./routes/magazine.js";
import { dailyRouter } from "./routes/daily.js";
import { notificationsRouter } from "./routes/notifications.js";
import { engagementRouter } from "./routes/engagement.js";
import { masteryRouter } from "./routes/mastery.js";
import { timeAttackRouter } from "./routes/time-attack.js";
import { doubtsRouter } from "./routes/doubts.js";
import { drillsRouter } from "./routes/drills.js";
import { studyPlanRouter } from "./routes/study-plan.js";
import { communityRouter } from "./routes/community.js";
import { scoreboardRouter } from "./routes/scoreboard.js";
import { billingPublicRouter, billingRouter, billingWebhookRouter } from "./routes/billing.js";
import { guestAuthPublicRouter, guestAuthRouter } from "./routes/auth.js";
import { examsPublicRouter } from "./routes/exams.js";
import { pushRouter } from "./routes/push.js";
import { tourRouter } from "./routes/tour.js";
import { startDevCaScheduler } from "./ca/scheduler.js";
import { startDailyScheduler } from "./daily/scheduler.js";
import { initSentry } from "./lib/sentry.js";
import { razorpayStatus } from "./lib/razorpay.js";

await initSentry();

const app = express();
const port = process.env.PORT ?? 4000;

// Behind Cloudflare/Render in production, the real client IP is in
// X-Forwarded-For; trust the proxy so req.ip reflects it (used by the per-IP
// guest-session rate limit, the per-user limiter's IP fallback, and logging).
// Off in dev so req.ip stays the direct socket. A spoofed XFF could rotate the
// app-level guest key, but Supabase's own anonymous_users per-IP limit is the
// authoritative backstop (see routes/auth.ts).
if (process.env.NODE_ENV === "production") app.set("trust proxy", true);

// ALLOWED_ORIGINS is a comma-separated list (prod web origin + any exact
// preview origins). Trailing slashes are stripped — an Origin header never
// has one, so a pasted "https://x.com/" would otherwise silently never match.
// ALLOWED_ORIGIN_SUFFIXES additionally allows-by-suffix so a different
// origin on every build isn't locked out without hand-maintaining an exact
// list. For Cloudflare Pages this MUST be scoped to your own project, e.g.
// ".<project-name>.pages.dev" — a bare ".pages.dev" would trust every  // portable-paths-allow: placeholder example, not a real domain
// Cloudflare Pages project anyone on the internet creates, since project
// names aren't namespaced to your account. (".vercel.app" has the same
// caveat if still on the paid Vercel path.) localhost:3000 is only
// auto-allowed outside production.
const isProduction = process.env.NODE_ENV === "production";
const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/$/, ""))
    .filter(Boolean)
    .concat(isProduction ? [] : ["http://localhost:3000"]),
);
const allowedOriginSuffixes = (process.env.ALLOWED_ORIGIN_SUFFIXES ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (isProduction && allowedOrigins.size === 0 && allowedOriginSuffixes.length === 0) {
  logger.warn(
    "ALLOWED_ORIGINS is unset in production — every browser request will be rejected by CORS until it's set.",
  );
}

app.use(
  cors({
    origin(origin, callback) {
      // No Origin header (curl, server-to-server, the Razorpay webhook) — allow.
      if (!origin) return callback(null, true);
      if (allowedOrigins.has(origin) || allowedOriginSuffixes.some((s) => origin.endsWith(s))) {
        return callback(null, true);
      }
      callback(new Error(`CORS: origin ${origin} not allowed`));
    },
  }),
);
app.use(helmet());
app.use(pinoHttp({ logger }));

// Razorpay webhook is mounted FIRST, with its own raw-body parser, so the HMAC
// signature can be verified against the exact bytes Razorpay signed — before
// express.json() consumes and re-serializes the stream. It is public (no auth):
// Razorpay authenticates via the signature, not a Supabase JWT.
app.use("/api/v1", billingWebhookRouter);

app.use(express.json());

// Public — no auth (liveness probe + JWKS warmup happen here).
app.use("/api/v1", healthRouter);

// Public — the /pricing marketing page needs the plan list while signed out.
app.use("/api/v1", billingPublicRouter);

// Public — the per-IP guest-session checkpoint (called before signInAnonymously).
app.use("/api/v1", guestAuthPublicRouter);

// Public — the exam registry (paper structures, display names, launch scope).
// Reference data about the product, identical for every caller; see the router.
app.use("/api/v1", examsPublicRouter);

// Everything below requires a valid Supabase session. requireAuth verifies the
// JWT, derives the user id, and binds it to the request's async context.
app.use("/api/v1", requireAuth);

// Authenticated: grant the trial when a guest upgrades to a real account.
app.use("/api/v1", guestAuthRouter);

app.use("/api/v1", streamRouter);
app.use("/api/v1", syllabusRouter);
app.use("/api/v1", questionsRouter);
app.use("/api/v1", questionReportsRouter);
app.use("/api/v1", testsRouter);
app.use("/api/v1", attemptsRouter);
app.use("/api/v1", dashboardRouter);
app.use("/api/v1", currentAffairsRouter);
app.use("/api/v1", profileRouter);
app.use("/api/v1", eventsRouter);
app.use("/api/v1", srsRouter);
app.use("/api/v1", answersRouter);
app.use("/api/v1", answerSessionsRouter);
app.use("/api/v1", notesRouter);
app.use("/api/v1", userNotesRouter);
app.use("/api/v1", magazineRouter);
app.use("/api/v1", dailyRouter);
app.use("/api/v1", notificationsRouter);
app.use("/api/v1", engagementRouter);
app.use("/api/v1", masteryRouter);
app.use("/api/v1", timeAttackRouter);
app.use("/api/v1", doubtsRouter);
app.use("/api/v1", drillsRouter);
app.use("/api/v1", studyPlanRouter);
app.use("/api/v1", communityRouter);
app.use("/api/v1", scoreboardRouter);
app.use("/api/v1", billingRouter);
app.use("/api/v1", pushRouter);
app.use("/api/v1", tourRouter);
app.use("/api/v1", adminRouter);

app.use("/api/v1", notFoundHandler);
app.use(errorHandler);

app.listen(port, () => {
  logger.info(`api listening on http://localhost:${port}`);
  // Surface a missing manual migration (0049/0070) loudly at boot — an ERROR
  // log, not a swallowed warn — so the mentor FAQ cache never silently no-ops.
  void checkMentorCacheHealthAtBoot();
  // Same shape, same reason: lib/exam-config.ts duplicates display names and
  // paper codes that the `exams` table owns, and nothing stops the two drifting.
  // Logs at ERROR on drift; never throws (see checkExamConfigRegistryAtBoot).
  void checkExamConfigRegistryAtBoot();
  // Make the active Razorpay TEST/LIVE mode visible at boot — never silent. A
  // present-but-inconsistent config (mode mismatch / bad key prefix) is an
  // ERROR so a bad test/live mix can't slip through unnoticed on deploy.
  const rzp = razorpayStatus();
  if (!rzp.configured) {
    logger.warn("billing: Razorpay is not configured — checkout/webhook will 500 until keys are set");
  } else if (rzp.misconfigured) {
    logger.error({ detail: rzp.detail }, "billing: Razorpay is MISCONFIGURED — refusing to transact until fixed");
  } else {
    logger.info({ mode: rzp.mode }, `billing: Razorpay configured in ${rzp.mode?.toUpperCase()} mode`);
  }
  if (process.env.NODE_ENV !== "production") {
    startDevCaScheduler();
    startDailyScheduler();
  }
});
