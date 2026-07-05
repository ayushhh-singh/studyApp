import { useTranslation } from "react-i18next";
import { Newspaper } from "lucide-react";
import { PageHeader } from "@/components/ui-x/page-header";
import { SectionCard } from "@/components/ui-x/section-card";
import { EmptyState } from "@/components/ui-x/empty-state";
import { ListRowSkeleton } from "@/components/ui-x/skeleton";
import { useCurrentAffairs } from "@/hooks/use-current-affairs";
import { useLocale } from "@/hooks/use-locale";

export const handle = { titleKey: "Nav.currentAffairs" };

export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { data, isLoading } = useCurrentAffairs({ page: 1 });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("CurrentAffairs.title")} description={t("CurrentAffairs.description")} />

      <SectionCard title={t("CurrentAffairs.latest")}>
        {isLoading ? (
          <div className="flex flex-col gap-2">
            <ListRowSkeleton />
            <ListRowSkeleton />
            <ListRowSkeleton />
          </div>
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            icon={Newspaper}
            title={t("CurrentAffairs.emptyTitle")}
            description={t("CurrentAffairs.emptyDescription")}
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {data.items.map((item) => (
              <li
                key={item.id}
                className="flex flex-col gap-1 rounded-lg border border-border bg-background px-3 py-2.5"
              >
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{new Date(item.date).toLocaleDateString(locale)}</span>
                  {item.is_up_specific && (
                    <span className="rounded-full bg-tulsi/15 px-2 py-0.5 font-semibold text-tulsi-foreground">
                      {t("CurrentAffairs.upSpecific")}
                    </span>
                  )}
                </div>
                <p className="text-sm font-medium">{item.title_i18n[locale]}</p>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
