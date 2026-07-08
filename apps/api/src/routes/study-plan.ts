import { Router } from "express";
import { activePlanResponseSchema, studyPlanResponseSchema, toggleTaskBodySchema } from "@prayasup/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { devUserId } from "../lib/dev-user.js";
import { getActivePlan, toggleTask } from "../services/study-plan.js";

export const studyPlanRouter = Router();
studyPlanRouter.use(rateLimit({ windowMs: 60_000, max: 60 }));

studyPlanRouter.get(
  "/study-plan",
  asyncHandler(async (_req, res) => {
    const state = await getActivePlan(devUserId());
    res.json(activePlanResponseSchema.parse({ data: state, error: null }));
  }),
);

studyPlanRouter.patch(
  "/study-plan/tasks",
  asyncHandler(async (req, res) => {
    const body = parse(toggleTaskBodySchema, req.body);
    const plan = await toggleTask(devUserId(), body.date, body.task_id, body.done);
    res.json(studyPlanResponseSchema.parse({ data: plan, error: null }));
  }),
);
