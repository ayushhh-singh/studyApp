import express from "express";
import cors from "cors";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { logger } from "./lib/logger.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { requireAuth } from "./middleware/require-auth.js";
import { healthRouter } from "./routes/health.js";
import { streamRouter } from "./routes/stream.js";
import { syllabusRouter } from "./routes/syllabus.js";
import { questionsRouter } from "./routes/questions.js";
import { testsRouter } from "./routes/tests.js";
import { attemptsRouter } from "./routes/attempts.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { currentAffairsRouter } from "./routes/current-affairs.js";
import { profileRouter } from "./routes/profile.js";
import { eventsRouter } from "./routes/events.js";
import { srsRouter } from "./routes/srs.js";
import { answersRouter } from "./routes/answers.js";
import { adminRouter } from "./routes/admin.js";
import { notesRouter } from "./routes/notes.js";
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
import { billingRouter, billingWebhookRouter } from "./routes/billing.js";
import { startDevCaScheduler } from "./ca/scheduler.js";
import { startDailyScheduler } from "./daily/scheduler.js";

const app = express();
const port = process.env.PORT ?? 4000;

app.use(
  cors({
    origin: "http://localhost:3000",
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

// Everything below requires a valid Supabase session. requireAuth verifies the
// JWT, derives the user id, and binds it to the request's async context.
app.use("/api/v1", requireAuth);

app.use("/api/v1", streamRouter);
app.use("/api/v1", syllabusRouter);
app.use("/api/v1", questionsRouter);
app.use("/api/v1", testsRouter);
app.use("/api/v1", attemptsRouter);
app.use("/api/v1", dashboardRouter);
app.use("/api/v1", currentAffairsRouter);
app.use("/api/v1", profileRouter);
app.use("/api/v1", eventsRouter);
app.use("/api/v1", srsRouter);
app.use("/api/v1", answersRouter);
app.use("/api/v1", notesRouter);
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
app.use("/api/v1", billingRouter);
app.use("/api/v1", adminRouter);

app.use("/api/v1", notFoundHandler);
app.use(errorHandler);

app.listen(port, () => {
  logger.info(`api listening on http://localhost:${port}`);
  if (process.env.NODE_ENV !== "production") {
    startDevCaScheduler();
    startDailyScheduler();
  }
});
