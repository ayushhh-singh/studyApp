import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import type { Locale, SyllabusNodeWithStats } from "@prayasup/shared";
import { Button } from "@/components/ui/button";
import { usePaperSummaries } from "@/hooks/use-paper-summaries";
import { usePaperTree } from "@/hooks/use-paper-tree";
import { useCreateCustomAnswerTest } from "@/hooks/use-create-custom-answer-test";

const INPUT_CLASS =
  "min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

interface FlatNode {
  node: SyllabusNodeWithStats;
  depth: number;
}

function flatten(nodes: SyllabusNodeWithStats[], depth = 0): FlatNode[] {
  return nodes.flatMap((node) => [{ node, depth }, ...flatten(node.children, depth + 1)]);
}

/** Descriptive sibling of practice/custom-test-builder.tsx — same multi-topic checkbox picker, no difficulty/exam filter (neither applies to descriptive PYQs). */
export function MainsCustomTestBuilder({ locale }: { locale: Locale }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: allPapers } = usePaperSummaries();
  const papers = useMemo(() => (allPapers ?? []).filter((p) => p.exam_stage === "mains"), [allPapers]);
  const [paperCode, setPaperCode] = useState<string>("");
  const [nodeIds, setNodeIds] = useState<string[]>([]);
  const { data: tree } = usePaperTree(paperCode || undefined);
  const [count, setCount] = useState(5);
  const createTest = useCreateCustomAnswerTest();

  const flatNodes = useMemo(
    () => (tree ? flatten(tree.children).filter((f) => f.node.own_pyq_count > 0) : []),
    [tree],
  );
  const selectedNodes = useMemo(() => flatNodes.filter((f) => nodeIds.includes(f.node.id)), [flatNodes, nodeIds]);
  const maxCount = Math.max(1, Math.min(50, selectedNodes.reduce((sum, f) => sum + f.node.own_pyq_count, 0) || 50));

  function toggleNode(id: string) {
    setNodeIds((prev) => (prev.includes(id) ? prev.filter((n) => n !== id) : [...prev, id]));
  }

  useEffect(() => {
    setCount((c) => Math.min(c, maxCount));
  }, [maxCount]);

  function handleSubmit() {
    if (nodeIds.length === 0) return;
    createTest.mutate(
      { node_ids: nodeIds, count },
      { onSuccess: (test) => navigate(`/${locale}/answers/session/${test.id}`) },
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
            setNodeIds([]);
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

      <fieldset className="flex flex-col gap-1.5 text-sm font-medium" disabled={!paperCode}>
        <legend className="mb-0.5">
          {t("Practice.customTopics")}
          {selectedNodes.length > 0 && (
            <span className="ms-1.5 font-normal text-muted-foreground">
              {t("Practice.customTopicsSelected", { count: selectedNodes.length })}
            </span>
          )}
        </legend>
        <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto rounded-lg border border-input bg-background p-1.5">
          {flatNodes.length === 0 ? (
            <p className="px-1.5 py-1 text-xs text-muted-foreground">{t("Practice.customTopicPlaceholder")}</p>
          ) : (
            flatNodes.map(({ node, depth }) => (
              <label
                key={node.id}
                className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-1.5 text-sm hover:bg-accent"
                style={{ paddingInlineStart: `${depth * 16 + 6}px` }}
              >
                <input
                  type="checkbox"
                  className="size-4 shrink-0 accent-primary"
                  checked={nodeIds.includes(node.id)}
                  onChange={() => toggleNode(node.id)}
                />
                <span className="min-w-0 flex-1 truncate">
                  {node.title_i18n[locale]} ({t("Learn.pyqCount", { count: node.own_pyq_count })})
                </span>
              </label>
            ))
          )}
        </div>
      </fieldset>

      <label className="flex max-w-40 flex-col gap-1.5 text-sm font-medium">
        {t("Practice.customCount")}
        <input
          type="number"
          className={INPUT_CLASS}
          min={1}
          max={maxCount}
          value={count}
          onChange={(e) => setCount(Math.min(maxCount, Math.max(1, Number(e.target.value) || 1)))}
        />
      </label>

      <Button type="button" onClick={handleSubmit} disabled={nodeIds.length === 0 || createTest.isPending} className="self-start">
        {createTest.isPending ? t("Practice.customCreating") : t("Practice.customCreate")}
      </Button>

      {createTest.isError && <p className="text-sm text-destructive">{createTest.error.message}</p>}
    </div>
  );
}
