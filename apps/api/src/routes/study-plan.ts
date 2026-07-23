import { Router } from "express";
import { activePlanResponseSchema, studyPlanResponseSchema, toggleTaskBodySchema } from "@neev/shared";
import { asyncHandler } from "../lib/async-handler.js";
import { parse } from "../lib/validation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { currentUserId } from "../lib/user-context.js";
import { deleteDay, deleteTask, getActivePlan, toggleTask } from "../services/study-plan.js";

export const studyPlanRouter = Router();
studyPlanRouter.use(rateLimit({ windowMs: 60_000, max: 60 }));

studyPlanRouter.get(
  "/study-plan",
  asyncHandler(async (_req, res) => {
    const state = await getActivePlan(currentUserId());
    res.json(activePlanResponseSchema.parse({ data: state, error: null }));
  }),
);

studyPlanRouter.patch(
  "/study-plan/tasks",
  asyncHandler(async (req, res) => {
    const body = parse(toggleTaskBodySchema, req.body);
    const plan = await toggleTask(currentUserId(), body.date, body.task_id, body.done);
    res.json(studyPlanResponseSchema.parse({ data: plan, error: null }));
  }),
);

studyPlanRouter.delete(
  "/study-plan/days/:date/tasks/:taskId",
  asyncHandler(async (req, res) => {
    await deleteTask(currentUserId(), req.params.date, req.params.taskId);
    res.status(204).end();
  }),
);

studyPlanRouter.delete(
  "/study-plan/days/:date",
  asyncHandler(async (req, res) => {
    await deleteDay(currentUserId(), req.params.date);
    res.status(204).end();
  }),
);
