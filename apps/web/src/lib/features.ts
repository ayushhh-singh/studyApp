import { PenLine, Target, Newspaper, BookOpen, BarChart3, MessagesSquare, Trophy, Users, type LucideIcon } from "lucide-react";

export type FeatureTint = "primary" | "marigold" | "tulsi" | "coral";

export interface FeatureDef {
  /** URL slug under /:locale/features/<slug>. */
  slug: string;
  /** i18n key under the "Features" namespace, e.g. Features.answerEvaluation.*. */
  i18nKey: string;
  icon: LucideIcon;
  tint: FeatureTint;
  /** /marketing/<screenshot>.png — falls back to a branded gradient panel if missing. */
  screenshot: string;
}

// Order matters: drives both the /features hub grid and internal-linking order.
// The first four intentionally reuse the exact icon/tint pairing the landing
// page's teaser section already uses for these same four features, so a
// visitor doesn't see a different accent color for the same feature between
// the landing page and its dedicated page.
export const FEATURES: FeatureDef[] = [
  { slug: "answer-evaluation", i18nKey: "answerEvaluation", icon: PenLine, tint: "primary", screenshot: "/marketing/evaluation.png" },
  { slug: "pyq-practice", i18nKey: "pyqPractice", icon: Target, tint: "marigold", screenshot: "/marketing/practice.png" },
  { slug: "notes", i18nKey: "notes", icon: BookOpen, tint: "tulsi", screenshot: "/marketing/notes.png" },
  { slug: "revision", i18nKey: "revision", icon: BarChart3, tint: "coral", screenshot: "/marketing/revision.png" },
  { slug: "current-affairs", i18nKey: "currentAffairs", icon: Newspaper, tint: "primary", screenshot: "/marketing/current-affairs.png" },
  { slug: "mentor", i18nKey: "mentor", icon: MessagesSquare, tint: "marigold", screenshot: "/marketing/mentor.png" },
  { slug: "gamified-practice", i18nKey: "gamifiedPractice", icon: Trophy, tint: "tulsi", screenshot: "/marketing/gamified-practice.png" },
  { slug: "community", i18nKey: "community", icon: Users, tint: "coral", screenshot: "/marketing/community.png" },
];

export function getFeatureBySlug(slug: string | undefined): FeatureDef | undefined {
  return FEATURES.find((f) => f.slug === slug);
}
