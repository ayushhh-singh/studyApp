import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Newspaper } from "lucide-react";
import { SectionCard } from "@/components/ui-x/section-card";
import { useWeeklyCaSets } from "@/hooks/use-current-affairs";
import { useLocale } from "@/hooks/use-locale";

/**
 * Surfaces this week's "CA Mains Set" (approved current-affairs descriptive
 * questions) alongside the daily answer set. Hidden entirely until a set exists,
 * so it never shows a dead card.
 */
export function CaMainsSetCard() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { data, isLoading } = useWeeklyCaSets();
  const mains = data?.mains;

  if (isLoading || !mains) return null;

  return (
    <SectionCard title={t("Answers.caMainsSetTitle")} className="border-marigold/30">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-2">
          <Newspaper className="mt-0.5 size-4 text-marigold-foreground" aria-hidden />
          <div>
            <p className="text-sm">{mains.title_i18n[locale]}</p>
            <p className="text-xs text-muted-foreground">
              {t("Answers.caMainsSetDescription")} · {t("Answers.totalCount", { count: mains.question_count })}
            </p>
          </div>
        </div>
        <Link
          to={`/${locale}/answers/session/${mains.id}`}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-marigold px-4 text-sm font-semibold text-marigold-foreground hover:bg-marigold/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("Answers.caMainsSetCta")}
        </Link>
      </div>
    </SectionCard>
  );
}
