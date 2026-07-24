import { create } from "zustand";

/**
 * The surfaces that can open the Sukoon paywall (F13 item 5). One consistent
 * interstitial, opened with the feature that triggered it so the copy can be
 * specific. Deliberately small + calm — never a guilt-trip.
 */
export type SukoonPaywallFeature =
  | "chat_cap"
  | "reflections"
  | "journeys"
  | "insights"
  | "voice"
  | "generic";

interface SukoonPaywallState {
  open: boolean;
  feature: SukoonPaywallFeature;
  openPaywall: (feature?: SukoonPaywallFeature) => void;
  close: () => void;
}

export const useSukoonPaywallStore = create<SukoonPaywallState>((set) => ({
  open: false,
  feature: "generic",
  openPaywall: (feature = "generic") => set({ open: true, feature }),
  close: () => set({ open: false }),
}));

/** Map a server 402 `feature` string (or a tier gate) onto a paywall feature. */
export function toSukoonPaywallFeature(feature: string | undefined): SukoonPaywallFeature {
  switch (feature) {
    case "chat_cap":
    case "reflections":
    case "journeys":
    case "insights":
    case "voice":
      return feature;
    // F10: the Pro-tier gate is an upgrade ask (route to the shared "voice"
    // copy) — but the MONTHLY MINUTE CAP (sukoon_voice_cap) is deliberately
    // NOT routed here: a Pro user who's used their 60 minutes this month is
    // already on the top tier, so "upgrade" is the wrong message. The voice
    // screen shows that state inline instead (see saathi-voice.tsx).
    case "sukoon_voice_pro":
      return "voice";
    default:
      return "generic";
  }
}
