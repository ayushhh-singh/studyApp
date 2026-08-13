import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/ui-x/page-header";
import { ResourcesContent } from "@/components/resources/resources-content";
import { useCurrentExam } from "@/hooks/use-current-exam";

export const handle = { titleKey: "Resources.navTitle" };

/**
 * /:locale/learn/resources — the IN-APP resources page.
 *
 * Same content as the public /:locale/resources, inside app-shell, because this
 * is a browse surface and in this app every browse surface keeps its chrome
 * (see ResourcesContent's header). Reached from Learn, where a reader working
 * through the syllabus is the person who actually wants the base texts.
 *
 * Sits under `learn/` rather than at a top level on purpose: it is study
 * material, and that is where a reader looks for it. The static `resources`
 * segment outranks the sibling `learn/:paperCode` dynamic route, so a paper
 * code can never swallow it — verified in the browser, not assumed.
 */
export function Component() {
  const { t } = useTranslation();
  const { name: examName } = useCurrentExam();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("Resources.title")}
        description={t("Resources.description", { exam: examName })}
      />
      <ResourcesContent />
    </div>
  );
}
