import {
  LayoutDashboard,
  BookOpen,
  PenSquare,
  NotebookPen,
  Newspaper,
  Brain,
  User,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  id: string;
  to: string;
  labelKey: string;
  icon: LucideIcon;
  flagship?: boolean;
  mobilePrimary?: boolean;
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
  { id: "current-affairs", to: "current-affairs", labelKey: "Nav.currentAffairs", icon: Newspaper },
  { id: "revision", to: "revision", labelKey: "Nav.revision", icon: Brain },
  { id: "profile", to: "profile", labelKey: "Nav.profile", icon: User },
];

export const MOBILE_PRIMARY_NAV = NAV_ITEMS.filter((item) => item.mobilePrimary);
export const MOBILE_MORE_NAV = NAV_ITEMS.filter((item) => !item.mobilePrimary);
