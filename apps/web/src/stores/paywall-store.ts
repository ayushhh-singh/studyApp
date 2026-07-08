import { create } from "zustand";

/** Which gated feature triggered the paywall (maps to the API's 402 `feature`). */
export type PaywallFeature =
  | "evaluation"
  | "handwritten_ocr"
  | "mock_tests"
  | "micro_drills"
  | "all_notes"
  | "generic";

interface PaywallState {
  open: boolean;
  feature: PaywallFeature;
  openPaywall: (feature?: PaywallFeature) => void;
  close: () => void;
}

export const usePaywallStore = create<PaywallState>((set) => ({
  open: false,
  feature: "generic",
  openPaywall: (feature = "generic") => set({ open: true, feature }),
  close: () => set({ open: false }),
}));

/** Map an ApiError 402 `feature` string onto a known paywall feature. */
export function toPaywallFeature(feature: string | undefined): PaywallFeature {
  switch (feature) {
    case "evaluation":
    case "handwritten_ocr":
    case "mock_tests":
    case "micro_drills":
    case "all_notes":
      return feature;
    default:
      return "generic";
  }
}
