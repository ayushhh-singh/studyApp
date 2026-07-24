import { Home, MessageCircle, NotebookPen, Wind, CircleUser, type LucideIcon } from "lucide-react";

export interface SukoonNavItem {
  id: string;
  /** Relative to the shell's own route base ("." = index) — resolves
   *  correctly whether mounted at /:locale/sukoon (integrated) or / (standalone). */
  to: string;
  labelKey: string;
  icon: LucideIcon;
  /** Passed to NavLink's `end` — only the index tab needs exact matching. */
  end?: boolean;
}

export const SUKOON_NAV_ITEMS: SukoonNavItem[] = [
  { id: "home", to: ".", end: true, labelKey: "Sukoon.navHome", icon: Home },
  { id: "saathi", to: "saathi", labelKey: "Sukoon.navSaathi", icon: MessageCircle },
  { id: "journal", to: "journal", labelKey: "Sukoon.navJournal", icon: NotebookPen },
  { id: "tools", to: "tools", labelKey: "Sukoon.navTools", icon: Wind },
  { id: "you", to: "you", labelKey: "Sukoon.navYou", icon: CircleUser },
];
