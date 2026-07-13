import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { AlertTriangle, Clock, ListChecks, X } from "lucide-react";
import type { Locale, TestDetail } from "@neev/shared";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui-x/page-header";

export function TestInstructions({
  test,
  locale,
  onStart,
  isStarting,
  error,
  backTo,
}: {
  test: TestDetail;
  locale: Locale;
  onStart: () => void;
  isStarting: boolean;
  error: Error | null;
  /** Where the close (X) button returns to — defaults to the Practice list. */
  backTo?: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="h-dvh overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => navigate(backTo ?? `/${locale}/practice`)}
          aria-label={t("Practice.exit")}
          className="self-start"
        >
          <X aria-hidden />
        </Button>

        <PageHeader title={test.title_i18n[locale]} description={test.paper_code ?? t("Practice.mixed")} />

        <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <ListChecks className="size-4" aria-hidden />
            {t("Practice.questionCount", { count: test.question_count })}
          </span>
          {test.duration_minutes && (
            <span className="flex items-center gap-1.5">
              <Clock className="size-4" aria-hidden />
              {t("Practice.minutes", { count: test.duration_minutes })}
            </span>
          )}
          {test.total_marks != null && <span>{t("Practice.marks", { count: test.total_marks })}</span>}
        </div>

        <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-5 shadow-sm">
          <h2 className="text-sm font-semibold">{t("Practice.instructionsTitle")}</h2>
          <ul className="flex list-disc flex-col gap-1.5 ps-5 text-sm text-muted-foreground">
            <li>{t("Practice.instructionOneQuestion")}</li>
            <li>{t("Practice.instructionAutosave")}</li>
            <li>{t("Practice.instructionPalette")}</li>
            {test.marking_scheme?.negative_marking ? (
              <li className="flex items-start gap-1.5 font-medium text-coral">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                {test.marking_scheme.note ??
                  t("Practice.instructionNegativeMarking", {
                    pct: Math.abs(test.marking_scheme.negative_marking * 100),
                  })}
              </li>
            ) : (
              <li>{t("Practice.instructionNoNegativeMarking")}</li>
            )}
          </ul>
        </div>

        {error && <p className="text-sm text-destructive">{error.message}</p>}

        <Button type="button" onClick={onStart} disabled={isStarting} size="lg" className="self-start">
          {isStarting
            ? t("Practice.starting")
            : test.attempts_count > 0
              ? t("Practice.resumeOrRetake")
              : t("Practice.startTest")}
        </Button>
      </div>
    </div>
  );
}
