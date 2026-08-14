import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Sparkles } from "lucide-react";
import type { Difficulty, Locale, SyllabusNodeWithStats } from "@neev/shared";
import { Button } from "@/components/ui/button";
import { usePaperSummaries } from "@/hooks/use-paper-summaries";
import { usePaperTree } from "@/hooks/use-paper-tree";
import { useCreateCustomTest } from "@/hooks/use-create-custom-test";
import { useCreateFreshCustomSet } from "@/hooks/use-create-fresh-set";

const INPUT_CLASS =
  "min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Per-set question ceiling (matches createCustomTestBodySchema / createFreshCustomSetBodySchema count max). */
const PRELIMS_SET_MAX = 100;

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
  const [nodeIds, setNodeIds] = useState<string[]>([]);
  const [difficulty, setDifficulty] = useState<Difficulty | "">("");
  // Two trees, same reason the count ceiling is decoupled from supply (see below):
  //  - `tree` is scoped by difficulty, so the per-node counts and the
  //    availableInBank the "Create practice set" gate reads reflect what a
  //    difficulty-filtered set would actually deliver.
  //  - `treeAll` is difficulty-AGNOSTIC. It decides WHICH topics appear, so
  //    choosing a difficulty with zero questions on a topic no longer HIDES
  //    that topic — you can still select it and "Show me a new set" builds
  //    what's available of that difficulty now and prepares more.
  const { data: tree } = usePaperTree(paperCode || undefined, undefined, difficulty || undefined);
  const { data: treeAll } = usePaperTree(paperCode || undefined);
  const [count, setCount] = useState(20);
  // Free-typed text for the number input, separate from `count` — clamping
  // on every keystroke (e.g. via `Number(e.target.value) || 1`) snapped an
  // emptied field straight to "1" mid-edit, making it impossible to type a
  // replacement digit without first typing e.g. "15" then deleting the "1".
  const [countInput, setCountInput] = useState(() => String(count));
  const createTest = useCreateCustomTest();
  // "Show me a new set" — a fresh, recency-excluded set drawn instantly from the
  // demand-aware reserve. `preparing` = the reserve can't fill this niche scope
  // yet (the request has been logged for tonight's top-up).
  const createFresh = useCreateFreshCustomSet();
  const [preparing, setPreparing] = useState(false);

  // The set of nodes that have ANY content (any difficulty) — the topic-list
  // filter, so a difficulty selection can't hide a real topic. own_*_count is the
  // exact node match (not subtree-aggregated), matching what createCustomTestFromNode
  // pulls, so the picker never over-promises what a parent topic can deliver.
  const contentNodeIds = useMemo(() => {
    const ids = new Set<string>();
    if (treeAll) for (const f of flatten(treeAll.children)) if (f.node.own_pyq_count > 0 || f.node.own_generated_count > 0) ids.add(f.node.id);
    return ids;
  }, [treeAll]);
  // Rows come from the difficulty-SCOPED tree (so their counts reflect the chosen
  // difficulty), but the filter is the difficulty-agnostic content set above.
  const flatNodes = useMemo(
    () => (tree ? flatten(tree.children).filter((f) => contentNodeIds.has(f.node.id)) : []),
    [tree, contentNodeIds],
  );
  const selectedNodes = useMemo(
    () => flatNodes.filter((f) => nodeIds.includes(f.node.id)),
    [flatNodes, nodeIds],
  );
  // PYQs fill first; AI-generated top up beyond them. The cap is PYQs + generated,
  // so a user can build a set larger than the PYQs alone (real questions still
  // come first in the actual set — see createCustomTestFromNode).
  const selectedPyq = useMemo(() => selectedNodes.reduce((sum, f) => sum + f.node.own_pyq_count, 0), [selectedNodes]);
  const selectedGen = useMemo(
    () => selectedNodes.reduce((sum, f) => sum + f.node.own_generated_count, 0),
    [selectedNodes],
  );
  // How many are actually in the bank for this exact selection (difficulty
  // scoped). "Create practice set" only draws from the bank, so it's honest only
  // up to this many.
  const availableInBank = selectedPyq + selectedGen;
  // The count ceiling is the paper's per-set limit (matches the backend schema),
  // NOT what's currently mapped — so choosing a difficulty no longer shrinks how
  // many you can ask for. Beyond what the bank holds, "Show me a new set" draws
  // what it can now and logs demand so tonight's top-up prepares the rest.
  const maxCount = PRELIMS_SET_MAX;
  const bankCanFill = nodeIds.length > 0 && availableInBank > 0 && count <= availableInBank;

  function toggleNode(id: string) {
    setNodeIds((prev) => (prev.includes(id) ? prev.filter((n) => n !== id) : [...prev, id]));
  }

  // Keep the count within the per-set ceiling (a constant now — the selection no
  // longer shrinks it; that freedom is the point of the reserve-backed fresh set).
  useEffect(() => {
    setCount((c) => Math.min(c, maxCount));
  }, [maxCount]);

  // Keep the input's displayed text in sync with the canonical clamped
  // value — covers the reclamp above; a no-op when the sync originated from
  // our own onChange below, since that already wrote matching text.
  useEffect(() => {
    setCountInput(String(count));
  }, [count]);

  function handleSubmit() {
    if (nodeIds.length === 0) return;
    createTest.mutate(
      { node_ids: nodeIds, count, difficulty: difficulty || undefined },
      { onSuccess: (test) => navigate(`/${locale}/practice/test/${test.id}`) },
    );
  }

  function handleFresh() {
    if (nodeIds.length === 0) return;
    setPreparing(false);
    createFresh.mutate(
      { node_ids: nodeIds, count, kind: "mcq", difficulty: difficulty || undefined },
      {
        onSuccess: (result) => {
          if (result.status === "ready") navigate(`/${locale}/practice/test/${result.test.id}`);
          else setPreparing(true);
        },
      },
    );
  }

  // A changed selection/count invalidates a stale "preparing" notice.
  useEffect(() => setPreparing(false), [nodeIds, count, difficulty]);

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

      {/* min-w-0: <fieldset> has a browser-default intrinsic min-width (min-content)
          that flexbox's normal shrink/stretch rules don't override on their own —
          without this it refuses to shrink below its longest topic label's natural
          width, pushing the whole card past the viewport at 390px regardless of the
          child span's own min-w-0/truncate below. */}
      <fieldset className="flex min-w-0 flex-col gap-1.5 text-sm font-medium" disabled={!paperCode}>
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
                  {node.title_i18n[locale]} ({t("Learn.pyqCount", { count: node.own_pyq_count })}
                  {node.own_generated_count > 0 && (
                    <span className="text-marigold-foreground"> · {t("Practice.customTopicAi", { count: node.own_generated_count })}</span>
                  )}
                  )
                </span>
              </label>
            ))
          )}
        </div>
      </fieldset>

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
            max={maxCount}
            value={countInput}
            onChange={(e) => {
              const raw = e.target.value;
              setCountInput(raw);
              if (raw === "") return; // let the field go empty mid-edit instead of snapping to the min
              const parsed = Number(raw);
              if (!Number.isNaN(parsed)) setCount(Math.min(maxCount, Math.max(1, parsed)));
            }}
            onBlur={() => setCountInput(String(count))} // discard an empty/invalid/out-of-range typed value
          />
        </label>
      </div>

      {selectedNodes.length > 0 && (
        <p className="-mt-1 text-xs text-muted-foreground">
          {availableInBank === 0 ? (
            <span className="font-medium text-marigold-foreground">{t("OnDemand.emptyBank")}</span>
          ) : count > availableInBank ? (
            <span className="font-medium text-marigold-foreground">{t("OnDemand.aboveBank", { available: availableInBank })}</span>
          ) : count > selectedPyq ? (
            <span className="font-medium text-marigold-foreground">
              {t("Practice.customFillMix", { pyq: selectedPyq, ai: count - selectedPyq })}
            </span>
          ) : (
            t("Practice.customFillPyq", { count })
          )}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={!bankCanFill || createTest.isPending || createFresh.isPending}
        >
          {createTest.isPending ? t("Practice.customCreating") : t("Practice.customCreate")}
        </Button>
        <Button
          type="button"
          // Becomes the solid primary once "Create practice set" can't fill the
          // request from the bank — so the one working action always reads as
          // primary, never a greyed-out primary next to a secondary-looking one.
          variant={nodeIds.length > 0 && !bankCanFill ? "default" : "outline"}
          onClick={handleFresh}
          disabled={nodeIds.length === 0 || createTest.isPending || createFresh.isPending}
          title={t("OnDemand.hint")}
        >
          <Sparkles className="size-4" /> {createFresh.isPending ? t("OnDemand.finding") : t("OnDemand.newSet")}
        </Button>
      </div>

      {createTest.isError && <p className="text-sm text-destructive">{createTest.error.message}</p>}
      {createFresh.isError && <p className="text-sm text-destructive">{createFresh.error.message}</p>}
      {preparing && (
        <div className="flex items-start gap-2 rounded-lg border border-marigold/30 bg-marigold/15 px-3 py-2 text-sm text-marigold-foreground">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-marigold-foreground" />
          <span>{t("OnDemand.preparing")}</span>
        </div>
      )}
    </div>
  );
}
