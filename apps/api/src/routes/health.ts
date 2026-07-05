import { Router } from "express";
import { healthResponseSchema } from "@prayasup/shared";

export const healthRouter = Router();

healthRouter.get("/health", (_req, res) => {
  const body = healthResponseSchema.parse({ data: { ok: true }, error: null });
  res.json(body);
});
