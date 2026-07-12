import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { PageHeader } from "@/components/ui-x/page-header";
import { SectionCard } from "@/components/ui-x/section-card";
import { Skeleton } from "@/components/ui-x/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FirstVisitCoachmark } from "@/components/ui-x/first-visit-coachmark";
import { BoardTable } from "@/components/scoreboard/board-table";
import { MainsOptInCard } from "@/components/scoreboard/mains-opt-in-card";
import { DimensionBestsPanel } from "@/components/scoreboard/dimension-bests-panel";
import {
  useDailyQuizTodayBoard,
  useDailyQuizWeeklyBoard,
  useDimensionBests,
  useMainsEssayBoard,
  useMainsWeeklyBoard,
  useMockSeriesBoard,
  useScoreboardMockTests,
  useScoreboardSectionalTests,
  useScoreboardTestBoard,
} from "@/hooks/use-scoreboard";

export const handle = { titleKey: "Scoreboard.title" };

const MAIN_TABS = ["prelims", "mains"] as const;
type MainTab = (typeof MAIN_TABS)[number];
function isMainTab(v: string | null): v is MainTab {
  return !!v && (MAIN_TABS as readonly string[]).includes(v);
}

const PRELIMS_SUBS = ["daily", "mocks", "sectionals"] as const;
type PrelimsSub = (typeof PRELIMS_SUBS)[number];
function isPrelimsSub(v: string | null): v is PrelimsSub {
  return !!v && (PRELIMS_SUBS as readonly string[]).includes(v);
}

const MAINS_SUBS = ["writing", "essay", "dimensions"] as const;
type MainsSub = (typeof MAINS_SUBS)[number];
function isMainsSub(v: string | null): v is MainsSub {
  return !!v && (MAINS_SUBS as readonly string[]).includes(v);
}

const MOCK_PAPERS = [
  { code: "PRE_GS1", label: "GS-I" },
  { code: "PRE_CSAT", label: "CSAT" },
] as const;

function BoardSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

function DailyQuizPanel() {
  const { t } = useTranslation();
  const [range, setRange] = useState<"today" | "week">("today");
  const today = useDailyQuizTodayBoard();
  const week = useDailyQuizWeeklyBoard();
  const board = range === "today" ? today : week;

  return (
    <SectionCard
      title={range === "today" ? t("Scoreboard.dailyQuizTodayTitle") : t("Scoreboard.dailyQuizWeeklyTitle")}
      action={
        <div className="flex items-center gap-0.5 rounded-full border border-border p-0.5">
          {(["today", "week"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              aria-pressed={range === r}
              className={
                "min-h-8 rounded-full px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
                (range === r ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")
              }
            >
              {r === "today" ? t("Scoreboard.dailyQuizTodayTitle") : t("Scoreboard.dailyQuizWeeklyTitle")}
            </button>
          ))}
        </div>
      }
    >
      {board.isLoading || !board.data ? (
        <BoardSkeleton />
      ) : (
        <BoardTable
          rows={board.data.rows}
          participants={board.data.participants}
          showTime={range === "today"}
          showDaysParticipated={range === "week"}
          emptyTitle={t("Scoreboard.emptyBoardTitle")}
          emptyDescription={t("Scoreboard.emptyBoardDescription")}
        />
      )}
    </SectionCard>
  );
}

function MocksPanel() {
  const { t } = useTranslation();
  const [paperCode, setPaperCode] = useState<string>(MOCK_PAPERS[0].code);
  const [testId, setTestId] = useState<string>("");
  const series = useMockSeriesBoard(paperCode);
  const tests = useScoreboardMockTests(paperCode);
  const testBoard = useScoreboardTestBoard(testId || undefined);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {MOCK_PAPERS.map((p) => (
          <button
            key={p.code}
            type="button"
            onClick={() => {
              setPaperCode(p.code);
              setTestId("");
            }}
            aria-pressed={paperCode === p.code}
            className={
              "min-h-9 rounded-full border px-3 text-xs font-semibold transition-colors " +
              (paperCode === p.code
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:text-foreground")
            }
          >
            {p.label}
          </button>
        ))}
      </div>

      <SectionCard title={t("Scoreboard.seriesTitle")}>
        {series.isLoading || !series.data ? (
          <BoardSkeleton />
        ) : (
          <BoardTable
            rows={series.data.rows}
            participants={series.data.participants}
            showMocksAttempted
            emptyTitle={t("Scoreboard.emptyBoardTitle")}
            emptyDescription={t("Scoreboard.emptyBoardDescription")}
          />
        )}
      </SectionCard>

      <SectionCard
        title={t("Scoreboard.subMocks")}
        action={
          <select
            className="min-h-9 max-w-[16rem] rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={testId}
            onChange={(e) => setTestId(e.target.value)}
          >
            <option value="">{t("Scoreboard.pickTestPlaceholder")}</option>
            {(tests.data ?? []).map((test) => (
              <option key={test.id} value={test.id}>
                {test.title_i18n.en}
              </option>
            ))}
          </select>
        }
      >
        {!testId ? (
          <p className="text-sm text-muted-foreground">{t("Scoreboard.pickTestPlaceholder")}</p>
        ) : testBoard.isLoading || !testBoard.data ? (
          <BoardSkeleton />
        ) : (
          <BoardTable
            rows={testBoard.data.rows}
            participants={testBoard.data.participants}
            showTime
            emptyTitle={t("Scoreboard.emptyBoardTitle")}
            emptyDescription={t("Scoreboard.emptyBoardDescription")}
          />
        )}
      </SectionCard>
    </div>
  );
}

function SectionalsPanel() {
  const { t } = useTranslation();
  const [testId, setTestId] = useState<string>("");
  const tests = useScoreboardSectionalTests();
  const testBoard = useScoreboardTestBoard(testId || undefined);

  return (
    <SectionCard
      title={t("Scoreboard.subSectionals")}
      action={
        <select
          className="min-h-9 max-w-[16rem] rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={testId}
          onChange={(e) => setTestId(e.target.value)}
        >
          <option value="">{t("Scoreboard.pickTestPlaceholder")}</option>
          {(tests.data ?? []).map((test) => (
            <option key={test.id} value={test.id}>
              {test.title_i18n.en}
            </option>
          ))}
        </select>
      }
    >
      {!testId ? (
        <p className="text-sm text-muted-foreground">{t("Scoreboard.pickTestPlaceholder")}</p>
      ) : testBoard.isLoading || !testBoard.data ? (
        <BoardSkeleton />
      ) : (
        <BoardTable
          rows={testBoard.data.rows}
          participants={testBoard.data.participants}
          showTime
          emptyTitle={t("Scoreboard.emptyBoardTitle")}
          emptyDescription={t("Scoreboard.emptyBoardDescription")}
        />
      )}
    </SectionCard>
  );
}

function MainsAnswerWritingPanel() {
  const { t } = useTranslation();
  const board = useMainsWeeklyBoard();

  if (board.isLoading || !board.data) return <BoardSkeleton />;

  return (
    <div className="flex flex-col gap-4">
      <MainsOptInCard optedIn={board.data.opted_in} yourStats={board.data.your_stats} />
      <SectionCard title={t("Scoreboard.subAnswerWriting")}>
        <BoardTable
          rows={board.data.rows}
          participants={board.data.participants}
          showAccuracy={false}
          scoreSuffix="%"
          emptyTitle={t("Scoreboard.emptyBoardTitle")}
          emptyDescription={t("Scoreboard.emptyBoardDescription")}
        />
      </SectionCard>
    </div>
  );
}

function MainsEssayPanel() {
  const { t } = useTranslation();
  const board = useMainsEssayBoard();

  if (board.isLoading || !board.data) return <BoardSkeleton />;

  return (
    <div className="flex flex-col gap-4">
      <MainsOptInCard optedIn={board.data.opted_in} yourStats={board.data.your_stats} />
      <SectionCard title={t("Scoreboard.subEssay")}>
        <BoardTable
          rows={board.data.rows}
          participants={board.data.participants}
          showAccuracy={false}
          scoreSuffix="%"
          emptyTitle={t("Scoreboard.emptyBoardTitle")}
          emptyDescription={t("Scoreboard.emptyBoardDescription")}
        />
      </SectionCard>
    </div>
  );
}

function MainsDimensionBestsPanel() {
  const data = useDimensionBests();
  if (data.isLoading || !data.data) return <BoardSkeleton />;
  return <DimensionBestsPanel boards={data.data.boards} />;
}

export function Component() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: MainTab = isMainTab(searchParams.get("tab")) ? (searchParams.get("tab") as MainTab) : "prelims";
  const rawSub = searchParams.get("sub");
  const prelimsSub: PrelimsSub = isPrelimsSub(rawSub) ? (rawSub as PrelimsSub) : "daily";
  const mainsSub: MainsSub = isMainsSub(rawSub) ? (rawSub as MainsSub) : "writing";
  const tabsRef = useRef<HTMLDivElement>(null);

  function setTab(next: MainTab) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next === "prelims") params.delete("tab");
        else params.set("tab", next);
        params.delete("sub");
        return params;
      },
      { replace: true },
    );
  }

  function setSub(next: string) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.set("sub", next);
        return params;
      },
      { replace: true },
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("Scoreboard.title")} description={t("Scoreboard.description")} />

      <FirstVisitCoachmark
        sectionKey="scoreboard"
        targetRef={tabsRef}
        message={t("Explore.coachmarkScoreboard")}
        dismissLabel={t("Explore.coachmarkGotIt")}
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as MainTab)}>
        <TabsList ref={tabsRef}>
          <TabsTrigger value="prelims">{t("Scoreboard.tabPrelims")}</TabsTrigger>
          <TabsTrigger value="mains">{t("Scoreboard.tabMains")}</TabsTrigger>
        </TabsList>

        <TabsContent value="prelims">
          <Tabs value={prelimsSub} onValueChange={setSub} className="mt-4">
            <TabsList>
              <TabsTrigger value="daily">{t("Scoreboard.subDailyQuiz")}</TabsTrigger>
              <TabsTrigger value="mocks">{t("Scoreboard.subMocks")}</TabsTrigger>
              <TabsTrigger value="sectionals">{t("Scoreboard.subSectionals")}</TabsTrigger>
            </TabsList>
            <TabsContent value="daily">
              <DailyQuizPanel />
            </TabsContent>
            <TabsContent value="mocks">
              <MocksPanel />
            </TabsContent>
            <TabsContent value="sectionals">
              <SectionalsPanel />
            </TabsContent>
          </Tabs>
        </TabsContent>

        <TabsContent value="mains">
          <Tabs value={mainsSub} onValueChange={setSub} className="mt-4">
            <TabsList>
              <TabsTrigger value="writing">{t("Scoreboard.subAnswerWriting")}</TabsTrigger>
              <TabsTrigger value="essay">{t("Scoreboard.subEssay")}</TabsTrigger>
              <TabsTrigger value="dimensions">{t("Scoreboard.subDimensionBests")}</TabsTrigger>
            </TabsList>
            <TabsContent value="writing">
              <MainsAnswerWritingPanel />
            </TabsContent>
            <TabsContent value="essay">
              <MainsEssayPanel />
            </TabsContent>
            <TabsContent value="dimensions">
              <MainsDimensionBestsPanel />
            </TabsContent>
          </Tabs>
        </TabsContent>
      </Tabs>
    </div>
  );
}
