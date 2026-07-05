import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import { AlertTriangle, CheckCircle2, FileQuestion, ImageOff, Loader2 } from "lucide-react";
import { Breadcrumbs } from "@/components/ui-x/breadcrumbs";
import { PageHeader } from "@/components/ui-x/page-header";
import { SectionCard } from "@/components/ui-x/section-card";
import { EmptyState } from "@/components/ui-x/empty-state";
import { Skeleton } from "@/components/ui-x/skeleton";
import { Button } from "@/components/ui/button";
import { useSubmissionDetail, useConfirmOcr } from "@/hooks/use-answers";
import { useOcrStream } from "@/hooks/use-ocr-stream";
import { useAnswerImageUrls } from "@/hooks/use-answer-image-urls";
import { useQuestion } from "@/hooks/use-questions";
import { useLocale } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";
import { scoreBandColor } from "@/lib/score-band";

export const handle = { titleKey: "Nav.answers" };

const LOW_CONFIDENCE_THRESHOLD = 0.6;

export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const navigate = useNavigate();
  const { submissionId = "" } = useParams<{ submissionId: string }>();

  const { data: detail, isLoading: isDetailLoading } = useSubmissionDetail(submissionId);
  const stream = useOcrStream(submissionId);
  const confirmOcr = useConfirmOcr(submissionId);
  const { data: catalogedQuestion } = useQuestion(detail?.submission.question_id ?? undefined);
  const { data: imageUrls } = useAnswerImageUrls(detail?.submission.image_paths);

  const [editedText, setEditedText] = useState<string | null>(null);

  useEffect(() => {
    if (submissionId) stream.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submissionId]);

  useEffect(() => {
    // Prefer an already-confirmed typed_text (resuming this screen after a
    // prior confirm) over the raw OCR replay, so a re-visit never discards edits.
    if (stream.done && editedText === null) {
      setEditedText(detail?.submission.typed_text || stream.done.ocr_text);
    }
  }, [stream.done, editedText, detail]);

  const questionText = detail?.submission.question_id
    ? catalogedQuestion?.stem_i18n[locale]
    : detail?.submission.custom_question_text_i18n?.[locale];

  if (isDetailLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  if (!detail || detail.submission.mode !== "handwritten") {
    return (
      <EmptyState
        icon={FileQuestion}
        title={t("Answers.evaluationNotFoundTitle")}
        description={t("Answers.evaluationNotFoundDescription")}
        action={
          <Button asChild>
            <Link to={`/${locale}/answers`}>{t("Answers.backToAnswers")}</Link>
          </Button>
        }
      />
    );
  }

  const confidence = stream.done?.ocr_confidence ?? 0;
  const confidenceColor = scoreBandColor(confidence * 100);
  const isLowConfidence = !!stream.done && confidence < LOW_CONFIDENCE_THRESHOLD;

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        items={[{ label: t("Nav.answers"), to: `/${locale}/answers` }, { label: t("Answers.confirmBreadcrumb") }]}
      />
      <PageHeader title={t("Answers.confirmTitle")} description={questionText ?? t("Answers.confirmDescription")} />

      {imageUrls && imageUrls.length > 0 && (
        <SectionCard title={t("Answers.confirmPagesTitle", { count: imageUrls.length })}>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {imageUrls.map((url, i) => (
              <img
                key={url}
                src={url}
                alt={t("Answers.handwrittenPageAlt", { number: i + 1 })}
                className="h-32 w-24 shrink-0 rounded-md border border-border object-cover"
              />
            ))}
          </div>
        </SectionCard>
      )}

      {stream.error && (
        <EmptyState
          icon={ImageOff}
          title={t("Answers.ocrErrorTitle")}
          description={stream.error}
          action={
            <div className="flex flex-col items-center gap-3">
              <ul className="list-disc pl-5 text-left text-sm text-muted-foreground">
                <li>{t("Answers.ocrTipLighting")}</li>
                <li>{t("Answers.ocrTipFlat")}</li>
                <li>{t("Answers.ocrTipFocus")}</li>
              </ul>
              <Button variant="outline" onClick={() => stream.start()}>
                {t("Answers.retryStream")}
              </Button>
            </div>
          }
        />
      )}

      {!stream.error && !stream.done && (
        <SectionCard title={t("Answers.ocrTranscribingTitle")}>
          <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {t("Answers.ocrTranscribingHint")}
          </div>
          {stream.text && (
            <p className="whitespace-pre-wrap text-base leading-[1.75] text-muted-foreground" lang={locale}>
              {stream.text}
            </p>
          )}
        </SectionCard>
      )}

      {stream.done && editedText !== null && (
        <SectionCard
          title={t("Answers.confirmReviewTitle")}
          action={
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
              style={{ backgroundColor: `color-mix(in oklch, ${confidenceColor} 15%, transparent)`, color: confidenceColor }}
            >
              {isLowConfidence ? <AlertTriangle className="size-3.5" aria-hidden /> : <CheckCircle2 className="size-3.5" aria-hidden />}
              {t("Answers.confirmConfidence", { pct: Math.round(confidence * 100) })}
            </span>
          }
        >
          <p className="text-sm text-muted-foreground">
            {isLowConfidence ? t("Answers.confirmLowConfidenceHint") : t("Answers.confirmHint")}
          </p>
          <textarea
            value={editedText}
            onChange={(e) => setEditedText(e.target.value)}
            lang={locale}
            dir="auto"
            rows={14}
            className={cn(
              "min-h-[280px] w-full resize-y rounded-lg border border-input bg-background p-4 text-base leading-[1.75] outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          />
          {confirmOcr.isError && <p className="text-sm text-destructive">{t("Answers.submitError")}</p>}
          <Button
            type="button"
            size="lg"
            className="self-start"
            disabled={!editedText.trim() || confirmOcr.isPending}
            onClick={() =>
              confirmOcr.mutate(editedText, {
                onSuccess: () => navigate(`/${locale}/answers/evaluation/${submissionId}`),
              })
            }
          >
            {confirmOcr.isPending ? t("Answers.submitting") : t("Answers.confirmCta")}
          </Button>
        </SectionCard>
      )}
    </div>
  );
}
