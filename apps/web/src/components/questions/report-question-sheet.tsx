import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Flag } from "lucide-react";
import type { QuestionReportReason } from "@neev/shared";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui-x/sheet";
import { Button } from "@/components/ui/button";
import { useReportQuestion } from "@/hooks/use-question-reports";

const REASONS: QuestionReportReason[] = ["wrong_answer", "wrong_explanation", "translation", "ambiguous", "other"];

/**
 * "Report this question" — a flag-icon sheet on every rendered question. Reasons
 * map to the audit taxonomy (wrong answer / wrong explanation / translation /
 * ambiguous / other) + free text. Two independent reports auto-hide the question
 * pending review (handled server-side).
 */
export function ReportQuestionSheet({ questionId, className }: { questionId: string; className?: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<QuestionReportReason>("wrong_answer");
  const [detail, setDetail] = useState("");
  const [done, setDone] = useState(false);
  const report = useReportQuestion();

  const submit = () => {
    report.mutate(
      { questionId, body: { reason, detail: detail.trim() || undefined } },
      { onSuccess: () => setDone(true) },
    );
  };

  const reset = () => {
    setDone(false);
    setDetail("");
    setReason("wrong_answer");
    report.reset();
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label={t("ReportQuestion.trigger")}
          title={t("ReportQuestion.trigger")}
          className={
            className ??
            "flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          }
        >
          <Flag className="size-3.5" aria-hidden />
        </button>
      </SheetTrigger>
      <SheetContent side="bottom" title={t("ReportQuestion.title")}>
        {done ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-foreground">{t("ReportQuestion.thanks")}</p>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("ReportQuestion.close")}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">{t("ReportQuestion.subtitle")}</p>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              {t("ReportQuestion.reasonLabel")}
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value as QuestionReportReason)}
                className="h-11 rounded-xl border border-input bg-background px-3.5 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {REASONS.map((r) => (
                  <option key={r} value={r}>
                    {t(`ReportQuestion.reason.${r}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              {t("ReportQuestion.detailLabel")}
              <textarea
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                rows={3}
                maxLength={1000}
                placeholder={t("ReportQuestion.detailPlaceholder")}
                className="rounded-xl border border-input bg-background px-3.5 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </label>
            {report.error && <p className="text-sm text-coral">{report.error.message}</p>}
            <Button onClick={submit} disabled={report.isPending}>
              {t("ReportQuestion.submit")}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
