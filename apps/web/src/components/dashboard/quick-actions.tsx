import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Brain, Newspaper, Sparkles, StickyNote, type LucideIcon } from "lucide-react";
import { SectionCard } from "@/components/ui-x/section-card";
import { useLocale } from "@/hooks/use-locale";

/**
 * The "Quick Actions" grid from docs/design/reference-2's mobile dashboard:
 * four icon tiles in a row, icon in a tinted rounded square with the label
 * beneath.
 *
 * The four here are deliberately NOT the reference's literal set, and not the
 * app's four most-used routes either: Dashboard/Learn/Answers/Practice are
 * already one tap away in the mobile bottom bar, so repeating them would buy a
 * phone user nothing. These are the four real surfaces that otherwise sit
 * behind the "More" sheet — which is exactly the reach problem a quick-action
 * grid exists to solve.
 */
const ACTIONS: { id: string; to: string; labelKey: string; icon: LucideIcon }[] = [
  { id: "revision", to: "revision", labelKey: "Nav.revision", icon: Brain },
  { id: "current-affairs", to: "current-affairs", labelKey: "Nav.currentAffairs", icon: Newspaper },
  { id: "my-notes", to: "my-notes", labelKey: "Nav.myNotes", icon: StickyNote },
  { id: "doubts", to: "doubts", labelKey: "Nav.doubts", icon: Sparkles },
];

export function QuickActionsCard() {
  const { t } = useTranslation();
  const locale = useLocale();

  return (
    <SectionCard title={t("Dashboard.quickActionsTitle")}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {ACTIONS.map(({ id, to, labelKey, icon: Icon }) => (
          <Link
            key={id}
            to={`/${locale}/${to}`}
            className="flex min-h-11 flex-col items-center justify-center gap-2 rounded-xl border border-border p-3 text-center transition-colors hover:border-primary/40 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Icon className="size-5" aria-hidden />
            </span>
            {/* Wraps rather than truncates: Devanagari labels here run longer
                than their English counterparts and a truncated nav label is
                worse than a two-line one at 390px. */}
            <span className="text-xs font-medium leading-snug">{t(labelKey)}</span>
          </Link>
        ))}
      </div>
    </SectionCard>
  );
}
