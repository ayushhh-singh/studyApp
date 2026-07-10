import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { BookOpenCheck, ListChecks, Newspaper } from "lucide-react";
import { SectionCard } from "@/components/ui-x/section-card";
import { useLocale } from "@/hooks/use-locale";

function istToday(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Quick links into the current month's two magazine editions. */
export function MagazineLinkCard() {
  const { t } = useTranslation();
  const locale = useLocale();
  const month = istToday().slice(0, 7);

  return (
    <SectionCard
      title={
        <span className="flex items-center gap-2">
          <Newspaper className="size-4 text-muted-foreground" aria-hidden /> {t("Magazine.navTitle")}
        </span>
      }
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <Link
          to={`/${locale}/magazine/${month}/prelims`}
          className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-medium transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ListChecks className="size-4 shrink-0 text-primary" aria-hidden />
          {t("Magazine.prelimsEditionTitle")}
        </Link>
        <Link
          to={`/${locale}/magazine/${month}/mains`}
          className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-medium transition-colors hover:border-marigold/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <BookOpenCheck className="size-4 shrink-0 text-marigold-foreground" aria-hidden />
          {t("Magazine.mainsEditionTitle")}
        </Link>
      </div>
    </SectionCard>
  );
}
