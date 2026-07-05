import type { ExamStage } from "@prayasup/shared";

export const queryKeys = {
  syllabusTree: (stage?: ExamStage) => ["syllabus", "tree", stage ?? "all"] as const,
  tests: (filters?: { kind?: string; paper?: string }) =>
    ["tests", "list", filters?.kind ?? "all", filters?.paper ?? "all"] as const,
  test: (id: string) => ["tests", "detail", id] as const,
  dashboardSummary: () => ["dashboard", "summary"] as const,
  profile: () => ["profile"] as const,
  currentAffairs: (filters?: { date?: string; category?: string; up_only?: boolean; page?: number }) =>
    [
      "current-affairs",
      filters?.date ?? "all",
      filters?.category ?? "all",
      filters?.up_only ?? "all",
      filters?.page ?? 1,
    ] as const,
};
