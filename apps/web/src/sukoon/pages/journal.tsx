import { NotebookPen } from "lucide-react";
import { PageHeader } from "@/components/ui-x/page-header";
import { EmptyState } from "@/components/ui-x/empty-state";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";

export function Component() {
  const { t } = useSukoonLanguage();
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <PageHeader title={t("Sukoon.journalTitle")} description={t("Sukoon.journalSub")} />
      <EmptyState
        icon={NotebookPen}
        title={t("Sukoon.comingSoonTitle")}
        description={t("Sukoon.journalComingSoon")}
      />
    </div>
  );
}
