import { useTranslation } from "react-i18next";
import { CheckCircle2, XCircle } from "lucide-react";
import type { AttemptResultDetail } from "@neev/shared";
import { SectionCard } from "@/components/ui-x/section-card";
import { useCutoffs } from "@/hooks/use-mocks";

/**
 * How a mock score stacks up against recent official UPPSC Prelims cut-offs.
 * Comparison is by percentage (the mock's raw total isn't exactly 200), then
 * expressed as an equivalent /200 mark. CSAT is qualifying-only (33%), so it
 * shows the qualifying line instead of year cut-offs.
 */
export function CutoffComparison({ result }: { result: AttemptResultDetail }) {
  const { t } = useTranslation();
  const isCsat = result.test?.paper_code === "PRE_CSAT";
  const { data: cutoffs } = useCutoffs("PRE_GS1", !isCsat);
  const scorePct = result.score_pct ?? 0;

  if (isCsat) {
    const qualified = scorePct >= 33;
    return (
      <SectionCard title={t("Practice.cutoffTitle")}>
        <div className="flex items-center gap-3 rounded-lg border border-border p-3">
          {qualified ? (
            <CheckCircle2 className="size-5 text-tulsi" aria-hidden />
          ) : (
            <XCircle className="size-5 text-coral" aria-hidden />
          )}
          <div className="flex flex-col">
            <span className="text-sm font-medium">
              {qualified ? t("Practice.cutoffQualified") : t("Practice.cutoffNotQualified")}
            </span>
            <span className="text-xs text-muted-foreground">
              {t("Practice.cutoffCsatHint", { your: Math.max(0, Math.round((scorePct / 100) * 200)) })}
            </span>
          </div>
        </div>
      </SectionCard>
    );
  }

  const general = (cutoffs ?? []).filter((c) => c.category === "general").sort((a, b) => b.year - a.year);
  // Negative marking can push a raw score below 0; clamp the displayed /200 equivalent.
  const yourMark = Math.max(0, Math.round((scorePct / 100) * 200));

  return (
    <SectionCard title={t("Practice.cutoffTitle")} description={t("Practice.cutoffDescription", { your: yourMark })}>
      <ul className="flex flex-col gap-2">
        {general.map((c) => {
          const cutoffPct = (c.cutoff / c.out_of) * 100;
          const cleared = scorePct >= cutoffPct;
          return (
            <li key={c.year} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <div className="flex items-center gap-2">
                {cleared ? (
                  <CheckCircle2 className="size-4 text-tulsi" aria-hidden />
                ) : (
                  <XCircle className="size-4 text-coral" aria-hidden />
                )}
                <span className="text-sm font-medium">
                  {c.year}
                  {!c.is_official && (
                    <span className="ml-1 text-[10px] font-semibold uppercase text-marigold">
                      {t("Practice.cutoffProvisional")}
                    </span>
                  )}
                </span>
              </div>
              <span className="text-sm tabular-nums text-muted-foreground">
                {t("Practice.cutoffRow", { cutoff: c.cutoff, out_of: c.out_of })}
              </span>
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}
