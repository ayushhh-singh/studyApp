import type { ExamStage, QuestionType } from "@prayasup/shared";

export const queryKeys = {
  syllabusTree: (stage?: ExamStage) => ["syllabus", "tree", stage ?? "all"] as const,
  paperSummaries: () => ["syllabus", "papers"] as const,
  paperTree: (paperCode: string) => ["syllabus", "papers", paperCode, "tree"] as const,
  syllabusNode: (nodeId: string) => ["syllabus", "nodes", nodeId] as const,
  tests: (filters?: { kind?: string; paper?: string }) =>
    ["tests", "list", filters?.kind ?? "all", filters?.paper ?? "all"] as const,
  test: (id: string) => ["tests", "detail", id] as const,
  attempt: (id: string) => ["attempts", "detail", id] as const,
  attemptResult: (id: string) => ["attempts", "result", id] as const,
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
  currentAffairsItem: (id: string) => ["current-affairs", "detail", id] as const,
  questions: (filters?: { type?: QuestionType; paper?: string; node?: string; year?: number; page?: number }) =>
    [
      "questions",
      filters?.type ?? "all",
      filters?.paper ?? "all",
      filters?.node ?? "all",
      filters?.year ?? "all",
      filters?.page ?? 1,
    ] as const,
  todaysQuestion: () => ["answers", "today"] as const,
  submissions: (page?: number) => ["answers", "submissions", page ?? 1] as const,
  submissionDetail: (id: string) => ["answers", "submissions", "detail", id] as const,
  adminStatus: () => ["admin", "status"] as const,
  reviewCounts: () => ["admin", "review", "counts"] as const,
  reviewQueue: (tab: string, page: number) => ["admin", "review", tab, page] as const,
};
