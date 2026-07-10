import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import { FileQuestion, Loader2, PenLine, Share2, Sparkles } from "lucide-react";
import { Breadcrumbs } from "@/components/ui-x/breadcrumbs";
import { PageHeader } from "@/components/ui-x/page-header";
import { EmptyState } from "@/components/ui-x/empty-state";
import { QueryErrorState } from "@/components/ui-x/query-error-state";
import { Skeleton } from "@/components/ui-x/skeleton";
import { Button } from "@/components/ui/button";
import { EvaluationDimensions } from "@/components/answers/evaluation-dimensions";
import { EvaluationScoreHero } from "@/components/answers/evaluation-score-hero";
import { EvaluationFeedback } from "@/components/answers/evaluation-feedback";
import { EvaluationAnalysisNotes } from "@/components/answers/evaluation-analysis-notes";
import { EvaluationModelAnswer } from "@/components/answers/evaluation-model-answer";
import { PercentileBand } from "@/components/scoreboard/percentile-band";
import { useSubmissionDetail } from "@/hooks/use-answers";
import { useEvaluationStream } from "@/hooks/use-evaluation-stream";
import { useAddEvaluationToRevision } from "@/hooks/use-add-to-revision";
import { useEvaluationPercentile } from "@/hooks/use-scoreboard";
import { useQuestion } from "@/hooks/use-questions";
import { useLocale } from "@/hooks/use-locale";
import { useShareAnswer } from "@/hooks/use-community";
import { formatQuestionStem } from "@/lib/format-question-stem";

export const handle = { titleKey: "Nav.answers" };

const PHASE_LABEL_KEYS: Record<string, string> = {
  grounding: "Answers.phaseGrounding",
  analyzing: "Answers.phaseAnalyzing",
  scoring: "Answers.phaseScoring",
  feedback: "Answers.phaseFeedback",
  model_answer: "Answers.phaseModelAnswer",
  persisting: "Answers.phasePersisting",
};

export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const navigate = useNavigate();
  const { submissionId = "" } = useParams<{ submissionId: string }>();
  const {
    data: detail,
    isLoading: isDetailLoading,
    isError: isDetailError,
    refetch: refetchDetail,
  } = useSubmissionDetail(submissionId);
  const stream = useEvaluationStream(submissionId, locale);
  const addToRevision = useAddEvaluationToRevision();
  const shareAnswer = useShareAnswer();
  const { data: percentile } = useEvaluationPercentile(stream.done ? submissionId : undefined);
  const { data: catalogedQuestion } = useQuestion(detail?.submission.question_id ?? undefined);

  useEffect(() => {
    // Also re-runs on a locale switch: a replay's feedback text is
    // per-locale (lazily translated server-side), so the URL's own /hi/ vs
    // /en/ prefix genuinely changes what this needs to fetch.
    if (submissionId) stream.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submissionId, locale]);

  const questionText = detail?.submission.question_id
    ? catalogedQuestion?.stem_i18n[locale]
    : detail?.submission.custom_question_text_i18n?.[locale];
  const formattedQuestionText = questionText ? formatQuestionStem(questionText) : questionText;

  if (isDetailLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  if (isDetailError) {
    // Distinct from "genuinely not found" below — a rate-limited/transient
    // fetch failure previously fell through to the exact same "not found"
    // copy with no retry, indistinguishable from a submission that's
    // actually gone.
    return <QueryErrorState onRetry={() => refetchDetail()} />;
  }

  if (!detail) {
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

  const retryHref = detail.submission.question_id
    ? `/${locale}/answers/write?question=${detail.submission.question_id}`
    : `/${locale}/answers/write`;

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        items={[{ label: t("Nav.answers"), to: `/${locale}/answers` }, { label: t("Answers.evaluationBreadcrumb") }]}
      />
      <PageHeader
        title={t("Answers.evaluationTitle")}
        description={formattedQuestionText ?? t("Answers.evaluationDescription")}
      />

      {stream.error && (
        <EmptyState
          icon={FileQuestion}
          title={t("Answers.evaluationErrorTitle")}
          description={stream.error}
          action={
            <Button variant="outline" onClick={() => stream.start({ force: true })}>
              {t("Answers.retryStream")}
            </Button>
          }
        />
      )}

      {!stream.error && stream.isStreaming && !stream.analysis && (
        <div className="flex items-center gap-2.5 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {t(stream.phase ? (PHASE_LABEL_KEYS[stream.phase] ?? "Answers.phaseGrounding") : "Answers.phaseGrounding")}
        </div>
      )}

      {stream.dimensions.length > 0 && <EvaluationDimensions dimensions={stream.dimensions} />}

      {stream.analysis && (
        <EvaluationScoreHero
          overallScore={stream.analysis.overall_score}
          maxScore={stream.analysis.max_score}
          isOffTopic={stream.analysis.is_off_topic}
          overallComment={stream.analysis.overall_comment}
        />
      )}

      {stream.analysis && <EvaluationAnalysisNotes analysis={stream.analysis} />}

      {stream.done && <PercentileBand data={percentile} />}

      <EvaluationFeedback
        strengths={stream.strengths}
        improvements={stream.improvements}
        isStreaming={stream.isStreaming}
      />

      <EvaluationModelAnswer
        yourAnswer={detail.submission.typed_text ?? ""}
        modelAnswer={stream.modelAnswer}
        isStreaming={stream.isStreaming}
      />

      {stream.done && (
        <div className="flex flex-wrap justify-center gap-3 pt-2">
          <Button asChild>
            <Link to={retryHref}>
              <PenLine aria-hidden />
              {t("Answers.reattemptCta")}
            </Link>
          </Button>
          <Button
            variant="outline"
            disabled={addToRevision.isPending || addToRevision.isSuccess}
            onClick={() => addToRevision.mutate(submissionId)}
          >
            <Sparkles aria-hidden />
            {addToRevision.isSuccess ? t("Learn.addedToRevision") : t("Answers.addKeyPointsCta")}
          </Button>
          <Button
            variant="ghost"
            disabled={shareAnswer.isPending}
            onClick={() =>
              shareAnswer.mutate(submissionId, {
                onSuccess: (shared) => navigate(`/${locale}/community/shared-answers/${shared.id}`),
              })
            }
          >
            <Share2 aria-hidden />
            {t("Answers.shareCta")}
          </Button>
        </div>
      )}
      {shareAnswer.isError && (
        <p className="text-center text-sm text-coral">{shareAnswer.error.message}</p>
      )}
    </div>
  );
}
