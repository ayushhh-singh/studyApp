import express from "express";
import cors from "cors";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { logger } from "./lib/logger.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
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
app.use(express.json());
app.use(pinoHttp({ logger }));

app.use("/api/v1", healthRouter);
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
