import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import type { Difficulty, Locale, SyllabusNodeWithStats } from "@prayasup/shared";
import { Button } from "@/components/ui/button";
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
  const { data: papers } = usePaperSummaries();
  const [paperCode, setPaperCode] = useState<string>("");
  const { data: tree } = usePaperTree(paperCode || undefined);
  const [nodeId, setNodeId] = useState<string>("");
  const [difficulty, setDifficulty] = useState<Difficulty | "">("");
  const [count, setCount] = useState(20);
  const createTest = useCreateCustomTest();

  const flatNodes = useMemo(
    () => (tree ? flatten(tree.children).filter((f) => f.node.pyq_count > 0) : []),
    [tree],
  );
  const selectedNode = flatNodes.find((f) => f.node.id === nodeId)?.node;

  function handleSubmit() {
    if (!nodeId) return;
    createTest.mutate(
      { node_id: nodeId, count, difficulty: difficulty || undefined },
      { onSuccess: (test) => navigate(`/${locale}/practice/test/${test.id}`) },
    );
  }

  return (
    <div className="flex flex-col gap-4">
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
          {(papers ?? []).map((paper) => (
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
              {node.title_i18n[locale]} ({t("Learn.pyqCount", { count: node.pyq_count })})
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
            max={Math.max(1, Math.min(100, selectedNode?.pyq_count ?? 100))}
            value={count}
            onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))}
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
