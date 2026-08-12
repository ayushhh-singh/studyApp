import { createContext, useContext, type ComponentProps } from "react";
import { Tabs as TabsPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

/**
 * Two looks, one component:
 *
 *   "pill"      (default) — the existing segmented control in a muted track.
 *   "underline" — the "Tab Active / Tab Inactive" pair from
 *                 docs/design/reference-3's BUTTONS & COMPONENTS panel: a
 *                 bordered strip, the active tab bold with a filled bar under
 *                 it, the inactive one muted with no bar.
 *
 * `underline` is opt-in rather than the new default on purpose. Every existing
 * tab strip in the app is a pill strip, several with five triggers tuned to
 * scroll rather than overflow at 390px (see TabsList below); flipping them all
 * would restyle a dozen screens that weren't part of this change. Both looks
 * appear in the reference — reference-1's course-detail page uses underline
 * tabs and its notes page uses pills.
 */
type TabsVariant = "pill" | "underline";
const TabsVariantContext = createContext<TabsVariant>("pill");

function TabsList({
  className,
  variant = "pill",
  ...props
}: ComponentProps<typeof TabsPrimitive.List> & { variant?: TabsVariant }) {
  return (
    <TabsVariantContext.Provider value={variant}>
      <TabsPrimitive.List
        data-variant={variant}
        className={cn(
          // overflow-x-auto: with many tabs (e.g. Practice's 5) the whitespace-nowrap
          // triggers can't shrink below their text width, so let the list scroll
          // horizontally instead of overflowing the page at 390px. No-op for 2-3 tabs.
          // scrollbar-hide: the native scrollbar this creates renders as a thick bar
          // under a row of rounded pills — still scrollable (swipe/drag/shift+wheel),
          // just without the visible track.
          "inline-flex w-full items-center overflow-x-auto scrollbar-hide",
          variant === "pill"
            ? "h-10 gap-1 rounded-lg bg-muted p-1 text-muted-foreground"
            : "gap-1 rounded-xl border border-border bg-card px-1 text-muted-foreground",
          className,
        )}
        {...props}
      />
    </TabsVariantContext.Provider>
  );
}

function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  const variant = useContext(TabsVariantContext);
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "inline-flex flex-1 items-center justify-center gap-1.5 text-sm whitespace-nowrap outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring",
        variant === "pill"
          ? // text-foreground/70 rather than inheriting the list's
            // --muted-foreground: muted-on-muted measures 4.4:1 here, just under
            // the 4.5 floor for text this size. 70% of the foreground is 7.0:1
            // and still reads clearly quieter than the active pill.
            "h-8 rounded-md px-3 font-medium text-foreground/70 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs"
          : // relative + an inset pseudo-bar rather than border-b: a border would
            // shift the label by 2px when it appears, and the bar has to sit on
            // the LIST's bottom edge, past the trigger's own padding.
            "relative min-h-11 rounded-lg px-4 font-medium data-[state=active]:font-semibold data-[state=active]:text-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-transparent data-[state=active]:after:bg-action",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn("mt-4 outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
