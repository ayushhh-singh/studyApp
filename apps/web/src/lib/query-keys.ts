import type { ExamCode, ExamStage, QuestionType } from "@prayasup/shared";

export const queryKeys = {
  syllabusTree: (stage?: ExamStage) => ["syllabus", "tree", stage ?? "all"] as const,
  paperSummaries: () => ["syllabus", "papers"] as const,
  paperTree: (paperCode: string, exam?: ExamCode) =>
    ["syllabus", "papers", paperCode, "tree", exam ?? "all"] as const,
  paperTrends: (paperCode: string, exam?: ExamCode) =>
    ["syllabus", "papers", paperCode, "trends", exam ?? "all"] as const,
  syllabusNode: (nodeId: string, exam?: ExamCode) => ["syllabus", "nodes", nodeId, exam ?? "all"] as const,
  tests: (filters?: { kind?: string; paper?: string; stage?: string }) =>
    ["tests", "list", filters?.kind ?? "all", filters?.paper ?? "all", filters?.stage ?? "all"] as const,
  test: (id: string) => ["tests", "detail", id] as const,
  answerSession: (id: string) => ["answer-sessions", "detail", id] as const,
  answerSessionResult: (id: string) => ["answer-sessions", "result", id] as const,
  attempt: (id: string) => ["attempts", "detail", id] as const,
  attemptResult: (id: string) => ["attempts", "result", id] as const,
  attempts: (page: number) => ["attempts", "list", page] as const,
  dashboardSummary: () => ["dashboard", "summary"] as const,
  profile: () => ["profile"] as const,
  profileAnalytics: () => ["profile", "analytics"] as const,
  drillRecommendation: () => ["drills", "recommendation"] as const,
  drillHistory: () => ["drills", "history"] as const,
  activePlan: () => ["study-plan", "active"] as const,
  currentAffairs: (filters?: { date?: string; category?: string; lens?: string; up_only?: boolean; page?: number }) =>
    [
      "current-affairs",
      filters?.date ?? "all",
      filters?.category ?? "all",
      filters?.lens ?? "all",
      filters?.up_only ?? "all",
      filters?.page ?? 1,
    ] as const,
  currentAffairsItem: (id: string) => ["current-affairs", "detail", id] as const,
  currentAffairsWeeklySets: () => ["current-affairs", "weekly-sets"] as const,
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
  reviewMagazine: (page: number) => ["admin", "magazine", "review", page] as const,
  noteForNode: (nodeId: string) => ["notes", "node", nodeId] as const,
  magazineMonths: () => ["magazine", "months"] as const,
  magazinePrelims: (month: string) => ["magazine", month, "prelims"] as const,
  magazineMains: (month: string) => ["magazine", month, "mains"] as const,
  dailyQuizArchive: (page: number) => ["daily-quiz", "archive", page] as const,
  notifications: () => ["notifications"] as const,
  pushStatus: () => ["push", "status"] as const,
  cutoffs: (exam: string) => ["mocks", "cutoffs", exam] as const,
  mastery: (paper?: string, exam?: ExamCode) => ["mastery", paper ?? "all", exam ?? "all"] as const,
  milestones: () => ["milestones"] as const,
  weeklyDigest: () => ["digest", "weekly"] as const,
  activityHeatmap: (weeks: number) => ["engagement", "heatmap", weeks] as const,
  timeAttackTopics: (paper: string) => ["time-attack", "topics", paper] as const,
  leaderboard: () => ["leaderboard"] as const,
  srsDue: (limit?: number) => ["srs", "due", limit ?? 30] as const,
  srsStats: () => ["srs", "stats"] as const,
  srsCards: (filters?: { query?: string; sourceType?: string; page?: number }) =>
    ["srs", "cards", filters?.query ?? "", filters?.sourceType ?? "all", filters?.page ?? 1] as const,
  doubtThreads: () => ["doubts", "threads"] as const,
  doubtThread: (id: string) => ["doubts", "threads", id] as const,
  mentorInsights: () => ["mentor", "insights"] as const,
  userNotes: (nodeId?: string) => ["user-notes", nodeId ?? "all"] as const,
  userNote: (id: string) => ["user-notes", "detail", id] as const,
  communityHub: () => ["community", "hub"] as const,
  communityThreads: (anchorType: string, anchorId: string, page?: number) =>
    ["community", "threads", anchorType, anchorId, page ?? 1] as const,
  communityThread: (id: string, page?: number) => ["community", "thread", id, page ?? 1] as const,
  sharedAnswers: (page?: number) => ["community", "shared-answers", page ?? 1] as const,
  sharedAnswer: (id: string) => ["community", "shared-answers", "detail", id] as const,
  communityBlocks: () => ["community", "blocks"] as const,
  adminReports: (page: number) => ["admin", "community", "reports", page] as const,
  adminReportsCounts: () => ["admin", "community", "reports", "counts"] as const,
  adminQuestionReports: (page: number) => ["admin", "question-reports", page] as const,
  scoreboardDailyToday: () => ["scoreboard", "daily-quiz", "today"] as const,
  scoreboardDailyWeekly: () => ["scoreboard", "daily-quiz", "weekly"] as const,
  scoreboardMockTests: (paperCode?: string) => ["scoreboard", "mocks", "tests", paperCode ?? "all"] as const,
  scoreboardMockSeries: (paperCode: string) => ["scoreboard", "mocks", "series", paperCode] as const,
  scoreboardSectionalTests: (paperCode?: string) => ["scoreboard", "sectionals", "tests", paperCode ?? "all"] as const,
  scoreboardTest: (testId: string) => ["scoreboard", "tests", testId] as const,
  scoreboardMainsWeekly: () => ["scoreboard", "mains", "weekly"] as const,
  scoreboardMainsEssay: () => ["scoreboard", "mains", "essay"] as const,
  scoreboardDimensionBests: () => ["scoreboard", "mains", "dimension-bests"] as const,
  scoreboardRankCardAttempt: (attemptId: string) => ["scoreboard", "rank-card", "attempt", attemptId] as const,
  scoreboardRankCardEvaluation: (submissionId: string) =>
    ["scoreboard", "rank-card", "evaluation", submissionId] as const,
  scoreboardMyRanks: () => ["scoreboard", "my-ranks"] as const,
};
