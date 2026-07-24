/**
 * Sukoon F11 — Home's "Sukoon Garden" card. Reads GET /garden and renders the
 * SVG plant at its current stage, plus a short line of copy that exists
 * specifically to set the right expectation: this only ever grows.
 */
import { SectionCard } from "@/components/ui-x/section-card";
import { Progress } from "@/components/ui/progress";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { useGardenState } from "@/sukoon/lib/use-sukoon-garden";
import { SukoonGardenPlant } from "@/sukoon/components/garden/sukoon-garden-plant";

const STAGE_LABEL_KEY: Record<string, string> = {
  seed: "Sukoon.garden.stage.seed",
  sprout: "Sukoon.garden.stage.sprout",
  sapling: "Sukoon.garden.stage.sapling",
  tree: "Sukoon.garden.stage.tree",
  blooming: "Sukoon.garden.stage.blooming",
};

export function SukoonGardenCard() {
  const { t } = useSukoonLanguage();
  const gardenQuery = useGardenState();
  const garden = gardenQuery.data;

  return (
    <SectionCard title={t("Sukoon.garden.title")} description={t("Sukoon.garden.subtitle")}>
      {gardenQuery.isPending ? (
        <div className="h-40 animate-pulse rounded-xl bg-muted" />
      ) : garden ? (
        <div className="flex items-center gap-5">
          <div className="size-24 shrink-0 sm:size-28">
            <SukoonGardenPlant stage={garden.stage} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <p className="text-sm font-semibold text-foreground">{t(STAGE_LABEL_KEY[garden.stage])}</p>
            {garden.next_stage_threshold != null ? (
              <>
                <Progress value={garden.progress_to_next * 100} className="h-1.5" />
                <p className="text-xs text-muted-foreground">
                  {t("Sukoon.garden.pointsToNext", {
                    points: Math.max(0, garden.next_stage_threshold - garden.growth_points),
                  })}
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">{t("Sukoon.garden.maxStage")}</p>
            )}
            <p className="text-xs text-muted-foreground">{t("Sukoon.garden.neverDecays")}</p>
          </div>
        </div>
      ) : null}
    </SectionCard>
  );
}
