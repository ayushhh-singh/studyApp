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
  MessagesSquare,
  StickyNote,
  Compass,
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
  { id: "learn", to: "learn", labelKey: "Nav.learn", icon: BookOpen },
  {
    id: "answers",
    to: "answers",
    labelKey: "Nav.answers",
    icon: NotebookPen,
    flagship: true,
    mobilePrimary: true,
  },
  { id: "practice", to: "practice", labelKey: "Nav.practice", icon: PenSquare, mobilePrimary: true },
  { id: "scoreboard", to: "scoreboard", labelKey: "Nav.scoreboard", icon: Trophy },
  { id: "current-affairs", to: "current-affairs", labelKey: "Nav.currentAffairs", icon: Newspaper },
  { id: "doubts", to: "doubts", labelKey: "Nav.doubts", icon: Sparkles },
  { id: "my-notes", to: "my-notes", labelKey: "Nav.myNotes", icon: StickyNote },
  // mobilePrimary (not "learn"): Revision is one of the dashboard's own
  // 4 daily-habit checklist items (Daily Quiz / Write Answers / Clear
  // Revision / Continue Reading) — burying it in the mobile "More" sheet
  // while Learn (a browse/reference activity) held a primary tab was a
  // mismatch between what the app treats as core daily habit and what's
  // one thumb-tap away. Desktop sidebar is unaffected (visibleNav() below
  // ignores this flag and always shows every item).
  { id: "revision", to: "revision", labelKey: "Nav.revision", icon: Brain, mobilePrimary: true },
  { id: "community", to: "community", labelKey: "Nav.community", icon: MessagesSquare },
  // The tour's permanent discovery surface — deliberately a real nav item
  // (not buried in Settings) so it's trivially findable on demand at any time.
  { id: "explore", to: "explore", labelKey: "Nav.explore", icon: Compass },
  { id: "review", to: "review", labelKey: "Nav.review", icon: ShieldCheck, adminOnly: true },
  { id: "profile", to: "profile", labelKey: "Nav.profile", icon: User },
];

/** NAV_ITEMS filtered by admin visibility — pass the resolved ADMIN_MODE flag. */
export function visibleNav(adminMode: boolean): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.adminOnly || adminMode);
}

export const MOBILE_PRIMARY_NAV = NAV_ITEMS.filter((item) => item.mobilePrimary);
export const MOBILE_MORE_NAV = NAV_ITEMS.filter((item) => !item.mobilePrimary);
