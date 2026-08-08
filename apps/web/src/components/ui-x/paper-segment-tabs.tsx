import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePaperCatalog } from "@/hooks/use-paper-catalog";

/** Sentinel for the optional "everything" segment. Not a paper code — no exam can mint it. */
export const ALL_PAPERS = "__all__";

/**
 * Paper segmentation, driven entirely by the exam registry.
 *
 * ── WHY THIS EXISTS RATHER THAN `["GS-I", "CSAT"]` INLINE ───────────────────
 * "GS and CSAT" is UPPSC/UPSC PRELIMS vocabulary, not a universal axis. The two
 * papers a daily quiz splits into come from `DAILY_QUIZ_VARIANTS`, which is
 * keyed PER EXAM and maps to that exam's OWN prelims paper codes
 * (`PRE_GS1`/`PRE_CSAT` for uppsc, `UPSC_PRE_GS1`/`UPSC_PRE_CSAT` for upsc).
 * Hardcoding either the codes or the labels would be an M13-class regression:
 * it would render another commission's paper names to a student preparing for a
 * different exam. Codes are passed in from the DATA; labels and ORDER come from
 * `usePaperCatalog`.
 *
 * Labels use `latinLabel` deliberately — "GS-I"/"CSAT" stay latin in both
 * locales on compact selectors like this one, per the product decision recorded
 * on `usePaperCatalog` itself (that is how aspirants refer to the papers, and
 * these pills are sized for an abbreviation). Prose surfaces keep `label`.
 *
 * ── CALLERS MUST GATE ON `usePaperCatalog().isLoading` ──────────────────────
 * `compare` falls back to `localeCompare` of RAW CODES for papers the registry
 * has not loaded yet, so rendering through the loading window shows a
 * provisional alphabetical order that visibly reshuffles — and, because
 * `Tabs` here is CONTROLLED, the caller's own `value` must likewise not be
 * derived from an empty catalog. This component cannot enforce that for you;
 * see `usePaperCatalog`'s docstring for the two regressions it has caused.
 */
export function PaperSegmentTabs({
  codes,
  value,
  onValueChange,
  includeAll = false,
  allLabel,
}: {
  /**
   * Paper codes to offer, in any order — sorted here by the catalog's own
   * comparator.
   *
   * ── KNOWN LIMITATION, deliberate: every current caller derives these from
   * the FIRST PAGE of its own list, so a paper that appears only deeper in the
   * history gets no tab. "All" still reaches it, so nothing is unreachable —
   * the filter set is merely incomplete.
   *
   * The alternative was worse: offering every paper in the exam's catalog
   * renders tabs that yield an empty list (up to ten of them for UPPSC), which
   * is more misleading than a short list, not less. Deriving a complete-and-
   * non-empty set needs a distinct-papers aggregate the API does not expose;
   * add one before "fixing" this by widening the source, or the cure is worse.
   */
  codes: string[];
  value: string;
  onValueChange: (next: string) => void;
  includeAll?: boolean;
  allLabel?: string;
}) {
  const { t } = useTranslation();
  const { latinLabel, compare } = usePaperCatalog();

  const ordered = useMemo(() => [...new Set(codes)].sort(compare), [codes, compare]);

  // One segment is not a choice — rendering a lone tab implies an alternative
  // that does not exist. (A single-paper exam, or a daily archive that has only
  // ever built one variant, both land here.)
  if (ordered.length < 2) return null;

  return (
    <Tabs value={value} onValueChange={onValueChange}>
      <TabsList>
        {includeAll && <TabsTrigger value={ALL_PAPERS}>{allLabel ?? t("Common.allPapers")}</TabsTrigger>}
        {ordered.map((code) => (
          <TabsTrigger key={code} value={code}>
            {latinLabel(code)}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
