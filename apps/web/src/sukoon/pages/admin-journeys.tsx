/**
 * Sukoon F7 — admin content queue for Guided Journeys: paste/upload a journey
 * JSON document → validate → preview (bilingual — every content node carries
 * both _hi and _en) → publish (bumps version) / unpublish. Self-gated the same
 * way Neev's own routes/review.tsx is (no router-level guard — this page
 * checks `is_admin` itself and renders a locked EmptyState otherwise), but via
 * Sukoon's OWN /admin/status probe (never Neev's `use-review` hook) so this
 * module never imports from a Neev feature module (CLAUDE.md's isolation rule).
 */
import { useEffect, useRef, useState } from "react";
import { Lock, Milestone, Upload } from "lucide-react";
import type { SukoonJourneyContent, SukoonJourneyStepContent, SukoonJourneyValidationIssue } from "@neev/shared";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui-x/page-header";
import { EmptyState } from "@/components/ui-x/empty-state";
import { Skeleton } from "@/components/ui-x/skeleton";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import {
  useSukoonAdminStatus,
  useAdminJourneys,
  useAdminJourneyDetail,
  useValidateJourneyContent,
  useUpsertJourneyContent,
  usePublishJourney,
  useUnpublishJourney,
} from "@/sukoon/lib/use-sukoon-admin-journeys";

const PLACEHOLDER = `{
  "slug": "your_journey_slug",
  "title_hi": "...",
  "title_en": "...",
  "description_hi": "...",
  "description_en": "...",
  "premium": false,
  "days": [
    { "day": 1, "steps": [
      { "type": "read", "title_hi": "...", "title_en": "...", "body_hi": "...", "body_en": "..." }
    ]}
  ]
}`;

export function Component() {
  const { t } = useSukoonLanguage();
  const statusQuery = useSukoonAdminStatus();

  if (statusQuery.isPending) {
    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  // A network/429 failure here is NOT "not an admin" — showing the denied
  // EmptyState would wrongly tell a real admin they lack access.
  if (statusQuery.isError) {
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-6">
        <PageHeader title={t("Sukoon.admin.journeys.title")} />
        <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
          {t("Sukoon.admin.journeys.loadError")}
        </p>
      </div>
    );
  }

  if (!statusQuery.data?.is_admin) {
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-6">
        <PageHeader title={t("Sukoon.admin.journeys.title")} />
        <EmptyState icon={Lock} title={t("Sukoon.admin.journeys.deniedTitle")} description={t("Sukoon.admin.journeys.deniedBody")} />
      </div>
    );
  }

  return <AdminJourneysQueue />;
}

function AdminJourneysQueue() {
  const { t, language } = useSukoonLanguage();
  const listQuery = useAdminJourneys();
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [raw, setRaw] = useState("");
  const [validation, setValidation] = useState<{
    valid: boolean;
    issues: SukoonJourneyValidationIssue[];
    content: SukoonJourneyContent | null;
  } | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const detailQuery = useAdminJourneyDetail(selectedSlug ?? undefined, {
    enabled: !!selectedSlug,
  });
  const validateMut = useValidateJourneyContent();
  const upsertMut = useUpsertJourneyContent();
  const publishMut = usePublishJourney();
  const unpublishMut = useUnpublishJourney();

  // Loading an existing journey into the editor — fires exactly once per slug
  // (a ref, not `raw === ""`, so manually clearing the textarea while editing
  // doesn't get silently refilled from the still-cached query data).
  const loadedSlugRef = useRef<string | null>(null);
  useEffect(() => {
    if (detailQuery.data && selectedSlug && loadedSlugRef.current !== selectedSlug) {
      loadedSlugRef.current = selectedSlug;
      setRaw(JSON.stringify(detailQuery.data.content, null, 2));
      setValidation(null);
      setParseError(null);
    }
  }, [detailQuery.data, selectedSlug]);

  const startNew = () => {
    loadedSlugRef.current = null;
    setSelectedSlug(null);
    setRaw(PLACEHOLDER);
    setValidation(null);
    setParseError(null);
  };
  const editExisting = (slug: string) => {
    if (loadedSlugRef.current === slug) loadedSlugRef.current = null; // force a reload if re-picking the same row
    setSelectedSlug(slug);
    setRaw("");
    setValidation(null);
    setParseError(null);
  };

  const onUploadFile = (file: File) => {
    file.text().then((text) => {
      setRaw(text);
      setValidation(null);
      setParseError(null);
    });
  };

  const onValidate = () => {
    setParseError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Invalid JSON");
      setValidation(null);
      return;
    }
    validateMut.mutate(parsed, { onSuccess: (result) => setValidation(result) });
  };

  const onSave = () => {
    if (!validation?.valid || !validation.content) return;
    upsertMut.mutate(validation.content, {
      onSuccess: () => {
        setValidation(null);
        void listQuery.refetch();
      },
    });
  };

  const content = validation?.content ?? null;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader title={t("Sukoon.admin.journeys.title")} description={t("Sukoon.admin.journeys.subtitle")} />

      {/* Queue list */}
      <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-foreground">{t("Sukoon.admin.journeys.queueTitle")}</p>
          <Button size="sm" onClick={startNew}>
            {t("Sukoon.admin.journeys.newJourney")}
          </Button>
        </div>
        {listQuery.isPending ? (
          <Skeleton className="h-24 w-full rounded-xl" />
        ) : (listQuery.data?.journeys ?? []).length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">{t("Sukoon.admin.journeys.emptyQueue")}</p>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {(listQuery.data?.journeys ?? []).map((j) => (
              <div key={j.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {language === "hi" ? j.title_hi : j.title_en}{" "}
                    <span className="text-xs font-normal text-muted-foreground">({j.slug})</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    v{j.version} · {j.days === 1 ? t("Sukoon.journeys.singleSession") : t("Sukoon.journeys.dayCount", { count: j.days })} · {j.total_steps} steps
                    {j.premium ? ` · ${t("Sukoon.tools.premiumBadge")}` : ""} ·{" "}
                    <span className={j.published ? "text-secondary" : "text-muted-foreground"}>
                      {j.published ? t("Sukoon.admin.journeys.published") : t("Sukoon.admin.journeys.unpublished")}
                    </span>
                  </p>
                </div>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => editExisting(j.slug)}>
                    {t("Sukoon.admin.journeys.edit")}
                  </Button>
                  {j.published ? (
                    <Button size="sm" variant="ghost" onClick={() => unpublishMut.mutate(j.slug)} disabled={unpublishMut.isPending}>
                      {t("Sukoon.admin.journeys.unpublish")}
                    </Button>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => publishMut.mutate(j.slug)} disabled={publishMut.isPending}>
                      {t("Sukoon.admin.journeys.publish")}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Editor */}
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-foreground">
            {selectedSlug ? t("Sukoon.admin.journeys.editingLabel", { slug: selectedSlug }) : t("Sukoon.admin.journeys.pasteNewLabel")}
          </p>
          <div className="flex gap-1.5">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onUploadFile(file);
                e.target.value = "";
              }}
            />
            <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
              <Upload className="size-3.5" />
              {t("Sukoon.admin.journeys.upload")}
            </Button>
          </div>
        </div>
        <textarea
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value);
            setValidation(null);
            setParseError(null);
          }}
          placeholder={PLACEHOLDER}
          rows={16}
          spellCheck={false}
          className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2 font-mono text-xs leading-relaxed text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={onValidate} disabled={!raw.trim() || validateMut.isPending}>
            {t("Sukoon.admin.journeys.validate")}
          </Button>
          <Button size="sm" variant="secondary" onClick={onSave} disabled={!validation?.valid || upsertMut.isPending}>
            {t("Sukoon.admin.journeys.save")}
          </Button>
        </div>

        {parseError ? (
          <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {t("Sukoon.admin.journeys.invalidJson")}: {parseError}
          </p>
        ) : null}

        {validation && !validation.valid ? (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <p className="mb-1 font-semibold">{t("Sukoon.admin.journeys.issuesTitle")}</p>
            <ul className="list-inside list-disc space-y-0.5">
              {validation.issues.map((issue, i) => (
                <li key={i}>
                  <span className="font-mono">{issue.path}</span>: {issue.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {validation?.valid && content ? (
          <div className="rounded-xl border border-secondary/40 bg-secondary/5 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-secondary">
              {t("Sukoon.admin.journeys.previewTitle")}
            </p>
            <div className="flex flex-col gap-3">
              {content.days.map((day) => (
                <div key={day.day} className="rounded-lg border border-border bg-card p-3">
                  <p className="mb-2 text-xs font-semibold text-muted-foreground">
                    {t("Sukoon.journeys.dayCount", { count: day.day })}
                  </p>
                  <div className="flex flex-col gap-2">
                    {day.steps.map((step, i) => (
                      <StepPreview key={i} step={step} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {upsertMut.isSuccess ? (
          <p className="text-xs text-secondary">{t("Sukoon.admin.journeys.saved")}</p>
        ) : null}
        {upsertMut.isError ? (
          <p className="text-xs text-destructive">{upsertMut.error?.message}</p>
        ) : null}
      </div>
    </div>
  );
}

/** Every field of one step, hi + en side by side — the bilingual preview
 *  (every content node carries both, per SUKOON_CONTEXT's bilingual rule). */
function StepPreview({ step }: { step: SukoonJourneyStepContent }) {
  const { t } = useSukoonLanguage();
  const fields: { label: string; hi: string; en: string }[] = [{ label: "title", hi: step.title_hi, en: step.title_en }];
  if (step.type === "read") fields.push({ label: "body", hi: step.body_hi, en: step.body_en });
  if (step.type === "journal_prompt") fields.push({ label: "prompt", hi: step.prompt_hi, en: step.prompt_en });
  if (step.type === "saathi_checkin") fields.push({ label: "seed_message", hi: step.seed_message_hi, en: step.seed_message_en });
  if (step.type === "checkin_scale") {
    fields.push({ label: "question", hi: step.question_hi, en: step.question_en });
    fields.push({ label: "scale_labels", hi: step.scale_labels_hi.join(" / "), en: step.scale_labels_en.join(" / ") });
  }

  return (
    <div className="rounded-lg bg-muted/40 p-2.5">
      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
        <Milestone className="size-3" aria-hidden />
        {step.type}
        {step.type === "exercise_ref" ? (
          <span className="font-mono font-normal">({step.exercise_key})</span>
        ) : null}
      </p>
      <div className="flex flex-col gap-1.5">
        {fields.map((f) => (
          <div key={f.label} className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
            <p>
              <span className="mr-1 font-mono text-[10px] text-muted-foreground">hi</span>
              {f.hi}
            </p>
            <p>
              <span className="mr-1 font-mono text-[10px] text-muted-foreground">en</span>
              {f.en}
            </p>
          </div>
        ))}
      </div>
      {fields.length === 0 ? <p className="text-xs text-muted-foreground">{t("Sukoon.admin.journeys.noFields")}</p> : null}
    </div>
  );
}
