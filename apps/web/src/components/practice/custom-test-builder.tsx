import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import type { Difficulty, ExamCode, Locale, SyllabusNodeWithStats } from "@prayasup/shared";
import { Button } from "@/components/ui/button";
import { ExamFilter } from "@/components/ui-x/exam-filter";
import { usePaperSummaries } from "@/hooks/use-paper-summaries";
import { usePaperTree } from "@/hooks/use-paper-tree";
import { useCreateCustomTest } from "@/hooks/use-create-custom-test";

const INPUT_CLASS =
  "min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

interface FlatNode {
  node: SyllabusNodeWithStats;
  depth: number;
}

function flatten(nodes: SyllabusNodeWithStats[], depth = 0): FlatNode[] {
  return nodes.flatMap((node) => [{ node, depth }, ...flatten(node.children, depth + 1)]);
}

export function CustomTestBuilder({ locale }: { locale: Locale }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: allPapers } = usePaperSummaries();
  // MCQ practice is Prelims-only (matches the same gate on "Practice this
  // topic" in learn-node.tsx) — Mains papers are entirely descriptive, so
  // building an MCQ custom set from one always errors with "no MCQ PYQs".
  const papers = useMemo(() => (allPapers ?? []).filter((p) => p.exam_stage === "prelims"), [allPapers]);
  const [paperCode, setPaperCode] = useState<string>("");
  const [nodeId, setNodeId] = useState<string>("");
  const [difficulty, setDifficulty] = useState<Difficulty | "">("");
  const [exam, setExam] = useState<ExamCode | undefined>(undefined);
  // Scope the tree fetch by the same exam filter used at creation time —
  // otherwise own_pyq_count (and which topics even appear) reflects "all
  // exams" while a single-exam pick could deliver fewer questions than shown,
  // or an empty set for a topic that only has PYQs from a different exam.
  const { data: tree } = usePaperTree(paperCode || undefined, exam);
  const [count, setCount] = useState(20);
  const createTest = useCreateCustomTest();

  // own_pyq_count (exact node match), NOT pyq_count (subtree-aggregated) —
  // createCustomTestFromNode only pulls questions mapped to this exact node,
  // so the picker must reflect that count or it over-promises what a parent
  // topic's dropdown row can actually deliver.
  const flatNodes = useMemo(
    () => (tree ? flatten(tree.children).filter((f) => f.node.own_pyq_count > 0) : []),
    [tree],
  );
  const selectedNode = flatNodes.find((f) => f.node.id === nodeId)?.node;

  // Reclamp the count whenever the selected topic changes — its own_pyq_count
  // (the input's max) can shrink on a new topic, but the input's value doesn't
  // reclamp itself, so a count typed for a larger topic (e.g. 100) would
  // otherwise silently survive a switch to a topic with far fewer PYQs (e.g.
  // 5) and get sent to the API as-is.
  useEffect(() => {
    if (!selectedNode) return;
    const max = Math.max(1, Math.min(100, selectedNode.own_pyq_count));
    setCount((c) => Math.min(c, max));
  }, [selectedNode]);

  function handleSubmit() {
    if (!nodeId) return;
    createTest.mutate(
      { node_id: nodeId, count, difficulty: difficulty || undefined, exam },
      { onSuccess: (test) => navigate(`/${locale}/practice/test/${test.id}`) },
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{t("Exam.filterLabel")}</span>
        <ExamFilter
          value={exam}
          onChange={(next) => {
            setExam(next);
            // The previously selected topic's own_pyq_count was computed
            // under the old exam scope — it may no longer be valid/visible.
            setNodeId("");
          }}
        />
      </div>

      <label className="flex flex-col gap-1.5 text-sm font-medium">
        {t("Practice.customPaper")}
        <select
          className={INPUT_CLASS}
          value={paperCode}
          onChange={(e) => {
            setPaperCode(e.target.value);
            setNodeId("");
          }}
        >
          <option value="">{t("Practice.customPaperPlaceholder")}</option>
          {papers.map((paper) => (
            <option key={paper.paper_code} value={paper.paper_code}>
              {paper.title_i18n[locale]}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1.5 text-sm font-medium">
        {t("Practice.customTopic")}
        <select
          className={INPUT_CLASS}
          value={nodeId}
          onChange={(e) => setNodeId(e.target.value)}
          disabled={!paperCode}
        >
          <option value="">{t("Practice.customTopicPlaceholder")}</option>
          {flatNodes.map(({ node, depth }) => (
            <option key={node.id} value={node.id}>
              {"— ".repeat(depth)}
              {node.title_i18n[locale]} ({t("Learn.pyqCount", { count: node.own_pyq_count })})
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {t("Practice.customDifficulty")}
          <select
            className={INPUT_CLASS}
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value as Difficulty | "")}
          >
            <option value="">{t("Practice.customDifficultyAny")}</option>
            <option value="easy">{t("Practice.customDifficultyEasy")}</option>
            <option value="medium">{t("Practice.customDifficultyMedium")}</option>
            <option value="hard">{t("Practice.customDifficultyHard")}</option>
          </select>
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {t("Practice.customCount")}
          <input
            type="number"
            className={INPUT_CLASS}
            min={1}
            max={Math.max(1, Math.min(100, selectedNode?.own_pyq_count ?? 100))}
            value={count}
            onChange={(e) => setCount(Math.min(100, Math.max(1, Number(e.target.value) || 1)))}
          />
        </label>
      </div>

      <Button type="button" onClick={handleSubmit} disabled={!nodeId || createTest.isPending} className="self-start">
        {createTest.isPending ? t("Practice.customCreating") : t("Practice.customCreate")}
      </Button>

      {createTest.isError && <p className="text-sm text-destructive">{createTest.error.message}</p>}
    </div>
  );
}
