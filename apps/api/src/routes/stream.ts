import { Router } from "express";
import { createSseConnection } from "../lib/sse.js";

export const streamRouter = Router();

streamRouter.get("/stream/ping", (req, res) => {
  const { send, close } = createSseConnection(req, res);

  let tick = 0;
  const interval = setInterval(() => {
    tick += 1;
    send("ping", { tick, at: new Date().toISOString() });
    if (tick >= 5) {
      clearInterval(interval);
      close();
    }
  }, 1000);

  req.on("close", () => clearInterval(interval));
});
