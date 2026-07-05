import { z } from "zod";
import { apiEnvelopeSchema } from "./types";

export const dashboardSummarySchema = z.object({
  attempts_count: z.number().int(),
  avg_score_pct: z.number().nullable(),
  streak_count: z.number().int(),
  srs_due_count: z.number().int(),
  latest_current_affairs_date: z.string().nullable(),
  weekly_activity: z.array(z.object({ date: z.string(), attempts: z.number().int() })),
});
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;

export const dashboardSummaryResponseSchema = apiEnvelopeSchema(dashboardSummarySchema);
export type DashboardSummaryResponse = z.infer<typeof dashboardSummaryResponseSchema>;
