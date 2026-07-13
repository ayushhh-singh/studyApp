import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, Inbox, Pencil, X } from "lucide-react";
import type { BilingualList, BilingualText, Locale, MagazineDeepDive, ReviewMagazineEditBody } from "@neev/shared";
import { SectionCard } from "@/components/ui-x/section-card";
import { EmptyState } from "@/components/ui-x/empty-state";
import { Skeleton } from "@/components/ui-x/skeleton";
import { Button } from "@/components/ui/button";
import {
  useMagazineDeepDiveApprove,
  useMagazineDeepDiveEdit,
  useMagazineDeepDiveReject,
  useReviewMagazine,
} from "@/hooks/use-review-magazine";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";

function Bilingual({ label, hi, en }: { label: string; hi: string; en: string }) {
  if (!hi.trim() && !en.trim()) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      {en.trim() && <p className="whitespace-pre-line text-sm leading-relaxed">{en}</p>}
      {hi.trim() && (
        <p className="whitespace-pre-line text-sm leading-[1.9]" lang="hi">
          {hi}
        </p>
      )}
    </div>
  );
}

function joinLines(list: BilingualList, locale: Locale): string {
  return list[locale].join("\n");
}

const publishGateOk = (d: Pick<MagazineDeepDive, "title_i18n" | "intro_i18n" | "synthesis_i18n">): boolean =>
  !!d.title_i18n.hi.trim() &&
  !!d.title_i18n.en.trim() &&
  !!d.intro_i18n.hi.trim() &&
  !!d.intro_i18n.en.trim() &&
  d.synthesis_i18n.hi.length > 0 &&
  d.synthesis_i18n.en.length > 0;

function DeepDiveReviewCard({ dive }: { dive: MagazineDeepDive }) {
  const { t } = useTranslation();
  const ok = publishGateOk(dive);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
          {dive.month} · #{dive.rank}
        </span>
        {dive.gs_papers.map((p) => (
          <span key={p} className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {p}
          </span>
        ))}
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs font-medium",
            ok ? "bg-tulsi/15 text-tulsi-foreground" : "bg-coral/15 text-coral-foreground",
          )}
        >
          {ok ? t("ReviewNotes.gateOk") : t("ReviewNotes.gateFail")}
        </span>
        <span className="ms-auto text-xs text-muted-foreground">
          {dive.model ?? "?"} · ${dive.cost_usd.toFixed(3)}
        </span>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-background p-3">
        <Bilingual label={t("Magazine.reviewTitle")} hi={dive.title_i18n.hi} en={dive.title_i18n.en} />
        <Bilingual label={t("Magazine.reviewIntro")} hi={dive.intro_i18n.hi} en={dive.intro_i18n.en} />
        <Bilingual label={t("Magazine.reviewSynthesis")} hi={dive.synthesis_i18n.hi.join("\n\n")} en={dive.synthesis_i18n.en.join("\n\n")} />
        <Bilingual label={t("CurrentAffairs.significance")} hi={dive.significance_i18n.hi.join("\n")} en={dive.significance_i18n.en.join("\n")} />
        <Bilingual label={t("CurrentAffairs.challenges")} hi={dive.challenges_i18n.hi.join("\n")} en={dive.challenges_i18n.en.join("\n")} />
        <Bilingual label={t("CurrentAffairs.wayForward")} hi={dive.way_forward_i18n.hi.join("\n")} en={dive.way_forward_i18n.en.join("\n")} />
        <Bilingual label={t("CurrentAffairs.valueKeywords")} hi={dive.keywords_i18n.hi.join(", ")} en={dive.keywords_i18n.en.join(", ")} />
        <Bilingual label={t("CurrentAffairs.caseExamples")} hi={dive.case_examples_i18n.hi.join("\n")} en={dive.case_examples_i18n.en.join("\n")} />
        {dive.sources.length > 0 && (
          <span className="text-xs text-muted-foreground">{t("Magazine.reviewSourceCount", { count: dive.sources.length })}</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Block-level edit form.
// ---------------------------------------------------------------------------
type ListField = "synthesis_i18n" | "significance_i18n" | "challenges_i18n" | "way_forward_i18n" | "keywords_i18n" | "case_examples_i18n";
type Draft = {
  title: BilingualText;
  intro: BilingualText;
  lists: Record<ListField, { hi: string; en: string }>;
};

function toDraft(d: MagazineDeepDive): Draft {
  return {
    title: d.title_i18n,
    intro: d.intro_i18n,
    lists: {
      synthesis_i18n: { hi: d.synthesis_i18n.hi.join("\n"), en: d.synthesis_i18n.en.join("\n") },
      significance_i18n: { hi: joinLines(d.significance_i18n, "hi"), en: joinLines(d.significance_i18n, "en") },
      challenges_i18n: { hi: joinLines(d.challenges_i18n, "hi"), en: joinLines(d.challenges_i18n, "en") },
      way_forward_i18n: { hi: joinLines(d.way_forward_i18n, "hi"), en: joinLines(d.way_forward_i18n, "en") },
      keywords_i18n: { hi: joinLines(d.keywords_i18n, "hi"), en: joinLines(d.keywords_i18n, "en") },
      case_examples_i18n: { hi: joinLines(d.case_examples_i18n, "hi"), en: joinLines(d.case_examples_i18n, "en") },
    },
  };
}

function lines(s: string): string[] {
  return s.split("\n").map((x) => x.trim()).filter(Boolean);
}

function draftToBody(d: Draft): ReviewMagazineEditBody {
  const body: ReviewMagazineEditBody = {
    title_i18n: { hi: d.title.hi.trim(), en: d.title.en.trim() },
    intro_i18n: { hi: d.intro.hi.trim(), en: d.intro.en.trim() },
  };
  for (const key of Object.keys(d.lists) as ListField[]) {
    body[key] = { hi: lines(d.lists[key].hi), en: lines(d.lists[key].en) };
  }
  return body;
}

function Field({
  label,
  hi,
  en,
  onHi,
  onEn,
  rows = 3,
}: {
  label: string;
  hi: string;
  en: string;
  onHi: (v: string) => void;
  onEn: (v: string) => void;
  rows?: number;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="grid gap-2 sm:grid-cols-2">
        <textarea
          value={en}
          onChange={(e) => onEn(e.target.value)}
          rows={rows}
          placeholder="English"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <textarea
          value={hi}
          onChange={(e) => onHi(e.target.value)}
          rows={rows}
          placeholder="हिन्दी"
          lang="hi"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm leading-[1.9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
    </div>
  );
}

function DeepDiveEditForm({
  dive,
  pending,
  onSubmit,
  onCancel,
}: {
  dive: MagazineDeepDive;
  pending: boolean;
  onSubmit: (body: ReviewMagazineEditBody, approve: boolean) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Draft>(() => toDraft(dive));

  const setList = (field: ListField, loc: Locale, v: string) =>
    setDraft((d) => ({ ...d, lists: { ...d.lists, [field]: { ...d.lists[field], [loc]: v } } }));

  const gateOk =
    draft.title.hi.trim().length > 0 &&
    draft.title.en.trim().length > 0 &&
    draft.intro.hi.trim().length > 0 &&
    draft.intro.en.trim().length > 0 &&
    lines(draft.lists.synthesis_i18n.hi).length > 0 &&
    lines(draft.lists.synthesis_i18n.en).length > 0;

  return (
    <div className="flex flex-col gap-4">
      <Field
        label={t("Magazine.reviewTitle")}
        en={draft.title.en}
        hi={draft.title.hi}
        onEn={(v) => setDraft((d) => ({ ...d, title: { ...d.title, en: v } }))}
        onHi={(v) => setDraft((d) => ({ ...d, title: { ...d.title, hi: v } }))}
        rows={2}
      />
      <Field
        label={t("Magazine.reviewIntro")}
        en={draft.intro.en}
        hi={draft.intro.hi}
        onEn={(v) => setDraft((d) => ({ ...d, intro: { ...d.intro, en: v } }))}
        onHi={(v) => setDraft((d) => ({ ...d, intro: { ...d.intro, hi: v } }))}
        rows={3}
      />
      <Field
        label={`${t("Magazine.reviewSynthesis")} (${t("ReviewNotes.onePerLine")})`}
        en={draft.lists.synthesis_i18n.en}
        hi={draft.lists.synthesis_i18n.hi}
        onEn={(v) => setList("synthesis_i18n", "en", v)}
        onHi={(v) => setList("synthesis_i18n", "hi", v)}
        rows={8}
      />
      <Field
        label={`${t("CurrentAffairs.significance")} (${t("ReviewNotes.onePerLine")})`}
        en={draft.lists.significance_i18n.en}
        hi={draft.lists.significance_i18n.hi}
        onEn={(v) => setList("significance_i18n", "en", v)}
        onHi={(v) => setList("significance_i18n", "hi", v)}
      />
      <Field
        label={`${t("CurrentAffairs.challenges")} (${t("ReviewNotes.onePerLine")})`}
        en={draft.lists.challenges_i18n.en}
        hi={draft.lists.challenges_i18n.hi}
        onEn={(v) => setList("challenges_i18n", "en", v)}
        onHi={(v) => setList("challenges_i18n", "hi", v)}
      />
      <Field
        label={`${t("CurrentAffairs.wayForward")} (${t("ReviewNotes.onePerLine")})`}
        en={draft.lists.way_forward_i18n.en}
        hi={draft.lists.way_forward_i18n.hi}
        onEn={(v) => setList("way_forward_i18n", "en", v)}
        onHi={(v) => setList("way_forward_i18n", "hi", v)}
      />
      <Field
        label={`${t("CurrentAffairs.valueKeywords")} (${t("ReviewNotes.onePerLine")})`}
        en={draft.lists.keywords_i18n.en}
        hi={draft.lists.keywords_i18n.hi}
        onEn={(v) => setList("keywords_i18n", "en", v)}
        onHi={(v) => setList("keywords_i18n", "hi", v)}
        rows={2}
      />
      <Field
        label={`${t("CurrentAffairs.caseExamples")} (${t("ReviewNotes.onePerLine")})`}
        en={draft.lists.case_examples_i18n.en}
        hi={draft.lists.case_examples_i18n.hi}
        onEn={(v) => setList("case_examples_i18n", "en", v)}
        onHi={(v) => setList("case_examples_i18n", "hi", v)}
      />

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <Button
          type="button"
          onClick={() => onSubmit(draftToBody(draft), true)}
          disabled={pending || !gateOk}
          className="bg-tulsi text-white hover:bg-tulsi/90"
        >
          <Check className="size-4" /> {t("ReviewNotes.saveApprove")}
        </Button>
        <Button type="button" variant="outline" onClick={() => onSubmit(draftToBody(draft), false)} disabled={pending}>
          {t("ReviewNotes.saveDraft")}
        </Button>
        {!gateOk && <span className="text-xs text-coral-foreground">{t("ReviewNotes.gateFail")}</span>}
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          {t("Review.cancel")}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------
export function MagazineReviewPanel() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [index, setIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const queryClient = useQueryClient();

  const queue = useReviewMagazine(page, true);
  const items = useMemo(() => queue.data?.items ?? [], [queue.data]);
  const totalPages = queue.data?.pagination.total_pages ?? 1;
  const current = items[Math.min(index, Math.max(0, items.length - 1))];

  const approve = useMagazineDeepDiveApprove();
  const reject = useMagazineDeepDiveReject();
  const edit = useMagazineDeepDiveEdit();
  const pending = approve.isPending || reject.isPending || edit.isPending;
  const actionError = (approve.error || reject.error || edit.error) as Error | null;

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["admin", "magazine", "review"] });
    queryClient.invalidateQueries({ queryKey: queryKeys.reviewCounts() });
  }, [queryClient]);

  useEffect(() => {
    if (!queue.isFetching && items.length === 0 && page > 1) setPage((p) => p - 1);
  }, [queue.isFetching, items.length, page]);
  useEffect(() => {
    if (index > items.length - 1) setIndex(Math.max(0, items.length - 1));
  }, [items.length, index]);

  if (queue.isLoading) return <Skeleton className="h-72 w-full" />;
  if (items.length === 0) {
    return <EmptyState icon={Inbox} title={t("ReviewMagazine.emptyTitle")} description={t("ReviewMagazine.emptyDescription")} />;
  }
  if (!current) return null;

  return (
    <SectionCard>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {t("Review.position", { current: index + 1, total: items.length })}
          {totalPages > 1 && ` · ${t("Learn.pageOf", { page, total: totalPages })}`}
        </span>
        <div className="flex gap-1">
          <Button type="button" variant="outline" size="icon-sm" aria-label={t("Review.prev")} disabled={index <= 0 || editing} onClick={() => setIndex((i) => Math.max(0, i - 1))}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button type="button" variant="outline" size="icon-sm" aria-label={t("Review.next")} disabled={index >= items.length - 1 || editing} onClick={() => setIndex((i) => Math.min(items.length - 1, i + 1))}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      {actionError && (
        <div className="rounded-lg border border-coral/30 bg-coral/10 px-3 py-2 text-sm text-coral-foreground">
          {actionError.message}
        </div>
      )}

      {editing ? (
        <DeepDiveEditForm
          key={current.id}
          dive={current}
          pending={pending}
          onCancel={() => setEditing(false)}
          onSubmit={(body, doApprove) =>
            edit.mutate(
              { id: current.id, body: { ...body, approve: doApprove } },
              { onSuccess: () => { setEditing(false); refresh(); } },
            )
          }
        />
      ) : (
        <>
          <DeepDiveReviewCard dive={current} />
          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            <Button
              type="button"
              onClick={() => approve.mutate(current.id, { onSuccess: refresh })}
              disabled={pending || !publishGateOk(current)}
              className="bg-tulsi text-white hover:bg-tulsi/90"
            >
              <Check className="size-4" /> {t("ReviewNotes.publish")}
            </Button>
            <Button type="button" variant="outline" onClick={() => setEditing(true)} disabled={pending}>
              <Pencil className="size-4" /> {t("Review.edit")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => reject.mutate({ id: current.id }, { onSuccess: refresh })}
              disabled={pending}
              className="border-coral/40 text-coral-foreground hover:bg-coral/10"
            >
              <X className="size-4" /> {t("ReviewNotes.sendBack")}
            </Button>
          </div>
        </>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-border pt-3">
          <Button type="button" variant="ghost" size="sm" disabled={page <= 1} onClick={() => { setPage((p) => p - 1); setIndex(0); }}>
            {t("Learn.prevPage")}
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={page >= totalPages} onClick={() => { setPage((p) => p + 1); setIndex(0); }}>
            {t("Learn.nextPage")}
          </Button>
        </div>
      )}
    </SectionCard>
  );
}
