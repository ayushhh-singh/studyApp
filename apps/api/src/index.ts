import express from "express";
import cors from "cors";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { logger } from "./lib/logger.js";
import { healthRouter } from "./routes/health.js";
import { streamRouter } from "./routes/stream.js";

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

app.listen(port, () => {
  logger.info(`api listening on http://localhost:${port}`);
});
