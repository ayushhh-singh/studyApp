import {
  LayoutDashboard,
  BookOpen,
  PenSquare,
  NotebookPen,
  Newspaper,
  Brain,
  Sparkles,
  ShieldCheck,
  Trophy,
  User,
  Users,
  MessagesSquare,
  StickyNote,
  Compass,
  CalendarDays,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  id: string;
  to: string;
  labelKey: string;
  icon: LucideIcon;
  flagship?: boolean;
  mobilePrimary?: boolean;
  /** Only shown when ADMIN_MODE is on (the question Review Queue). */
  adminOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", to: "dashboard", labelKey: "Nav.dashboard", icon: LayoutDashboard, mobilePrimary: true },
  { id: "learn", to: "learn", labelKey: "Nav.learn", icon: BookOpen, mobilePrimary: true },
  {
    id: "answers",
    to: "answers",
    labelKey: "Nav.answers",
    icon: NotebookPen,
    flagship: true,
    mobilePrimary: true,
  },
  { id: "practice", to: "practice", labelKey: "Nav.practice", icon: PenSquare, mobilePrimary: true },
  // Its own top-level surface, immediately after Practice — a scheduled series
  // with a published calendar, a shared cohort and a ranked window is a
  // different product from ad-hoc practice, and burying it inside a tab there
  // read as "just another mock".
  //
  // Deliberately NOT `flagship: true` — that flag is Answers' identity in this
  // design system (it carries the gauge/gold accent).
  //
  // It IS `mobilePrimary`, which takes the bottom bar from the 4-primary +
  // More layout to 5 + More. Three things make that the right call rather than
  // demoting an existing tab:
  //
  //  1. There is no data to demote ON. Every series is still `draft`, so it has
  //     zero attempts and no `feature_first_touch` key; and this app records no
  //     nav-click or page-view events for ANY tab, so "which tab is least used"
  //     is unanswerable today. Reshuffling on a guess is worse than one extra
  //     slot. Revisit if real usage data ever exists.
  //  2. It genuinely belongs beside Practice and Answers rather than under
  //     either. `test_series.stage` splits the built calendars down the middle
  //     (2 prelims / 2 mains), so a series spans MCQ practice AND answer
  //     writing; filing it under Practice would assert a hierarchy that is
  //     false for the answer-writing half.
  //  3. Six labels still fit at 390px — measured, 65px per slot with no
  //     truncation in either locale. Seven would not ("Dashboard" alone needs
  //     ~58px of a ~56px slot).
  //
  // Position is inherited from this list, so the bar reads in the same order as
  // the sidebar: Dashboard, Learn, Answers, Practice, Test Series, More.
  {
    id: "test-series",
    to: "test-series",
    labelKey: "Nav.testSeries",
    icon: CalendarDays,
    mobilePrimary: true,
  },
  { id: "scoreboard", to: "scoreboard", labelKey: "Nav.scoreboard", icon: Trophy },
  { id: "current-affairs", to: "current-affairs", labelKey: "Nav.currentAffairs", icon: Newspaper },
  { id: "doubts", to: "doubts", labelKey: "Nav.doubts", icon: Sparkles },
  { id: "my-notes", to: "my-notes", labelKey: "Nav.myNotes", icon: StickyNote },
  { id: "revision", to: "revision", labelKey: "Nav.revision", icon: Brain },
  { id: "community", to: "community", labelKey: "Nav.community", icon: MessagesSquare },
  // The tour's permanent discovery surface — deliberately a real nav item
  // (not buried in Settings) so it's trivially findable on demand at any time.
  { id: "explore", to: "explore", labelKey: "Nav.explore", icon: Compass },
  { id: "review", to: "review", labelKey: "Nav.review", icon: ShieldCheck, adminOnly: true },
  { id: "admin-users", to: "admin-users", labelKey: "Nav.adminUsers", icon: Users, adminOnly: true },
  { id: "profile", to: "profile", labelKey: "Nav.profile", icon: User },
];

/** NAV_ITEMS filtered by admin visibility — pass the resolved ADMIN_MODE flag. */
export function visibleNav(adminMode: boolean): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.adminOnly || adminMode);
}

export const MOBILE_PRIMARY_NAV = NAV_ITEMS.filter((item) => item.mobilePrimary);

export const MOBILE_MORE_NAV = NAV_ITEMS.filter((item) => !item.mobilePrimary);
