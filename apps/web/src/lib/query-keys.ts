import type { ExamCode, ExamStage, QuestionType } from "@prayasup/shared";

export const queryKeys = {
  syllabusTree: (stage?: ExamStage) => ["syllabus", "tree", stage ?? "all"] as const,
  paperSummaries: () => ["syllabus", "papers"] as const,
  paperTree: (paperCode: string, exam?: ExamCode) =>
    ["syllabus", "papers", paperCode, "tree", exam ?? "all"] as const,
  paperTrends: (paperCode: string, exam?: ExamCode) =>
    ["syllabus", "papers", paperCode, "trends", exam ?? "all"] as const,
  syllabusNode: (nodeId: string, exam?: ExamCode) => ["syllabus", "nodes", nodeId, exam ?? "all"] as const,
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
  questions: (filters?: {
    type?: QuestionType;
    paper?: string;
    node?: string;
    year?: number;
    exam?: ExamCode;
    page?: number;
  }) =>
    [
      "questions",
      filters?.type ?? "all",
      filters?.paper ?? "all",
      filters?.node ?? "all",
      filters?.year ?? "all",
      filters?.exam ?? "all",
      filters?.page ?? 1,
    ] as const,
  todaysQuestion: () => ["answers", "today"] as const,
  dailyAnswerSet: () => ["answers", "daily-set"] as const,
  submissions: (page?: number) => ["answers", "submissions", page ?? 1] as const,
  submissionDetail: (id: string) => ["answers", "submissions", "detail", id] as const,
  adminStatus: () => ["admin", "status"] as const,
  reviewCounts: () => ["admin", "review", "counts"] as const,
  reviewQueue: (tab: string, page: number) => ["admin", "review", tab, page] as const,
  reviewNotes: (page: number) => ["admin", "notes", "review", page] as const,
  noteForNode: (nodeId: string) => ["notes", "node", nodeId] as const,
  magazineMonths: () => ["magazine", "months"] as const,
  magazine: (month: string) => ["magazine", month] as const,
  dailyQuizArchive: (page: number) => ["daily-quiz", "archive", page] as const,
  notifications: () => ["notifications"] as const,
  cutoffs: (exam: string) => ["mocks", "cutoffs", exam] as const,
  mastery: (paper?: string) => ["mastery", paper ?? "all"] as const,
  milestones: () => ["milestones"] as const,
  weeklyDigest: () => ["digest", "weekly"] as const,
  activityHeatmap: (weeks: number) => ["engagement", "heatmap", weeks] as const,
  timeAttackTopics: () => ["time-attack", "topics"] as const,
  leaderboard: () => ["leaderboard"] as const,
  srsDue: (limit?: number) => ["srs", "due", limit ?? 30] as const,
  srsStats: () => ["srs", "stats"] as const,
  srsCards: (filters?: { query?: string; sourceType?: string; page?: number }) =>
    ["srs", "cards", filters?.query ?? "", filters?.sourceType ?? "all", filters?.page ?? 1] as const,
  doubtThreads: () => ["doubts", "threads"] as const,
  doubtThread: (id: string) => ["doubts", "threads", id] as const,
  mentorInsights: () => ["mentor", "insights"] as const,
};
