import { useTranslation } from "react-i18next";
import { Brain } from "lucide-react";
import { EmptyState } from "@/components/ui-x/empty-state";
import { SeedButtons } from "./seed-buttons";

/**
 * Teaches the feature and offers two one-tap seeds against the user's real
 * data — never sample/placeholder cards. The same seeds stay reachable later
 * via the Manage tab (see SeedButtons) once this empty state is gone.
 */
export function RevisionEmptyState() {
  const { t } = useTranslation();

  return (
    <EmptyState
      icon={Brain}
      title={t("Revision.emptyTitle")}
      description={t("Revision.emptyDescription")}
      action={<SeedButtons />}
    />
  );
}
