import type { ComponentProps } from "react";
import { Dialog } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const Sheet = Dialog.Root;
const SheetTrigger = Dialog.Trigger;

function SheetContent({
  className,
  children,
  side = "bottom",
  title,
  ...props
}: ComponentProps<typeof Dialog.Content> & { side?: "bottom" | "right"; title: string }) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:animate-in data-[state=open]:fade-in" />
      <Dialog.Content
        className={cn(
          "fixed z-50 flex flex-col gap-4 border-border bg-card p-4 shadow-2xl outline-none focus-visible:outline-none",
          side === "bottom" &&
            // overflow-y-auto: max-h alone clips content taller than 75vh with
            // no way to reach it (default CSS overflow is visible, which here
            // means invisible — the fixed-position dialog has nothing below it
            // to scroll into). A long question palette (100+ cells) or any
            // other tall sheet content needs this to stay reachable.
            "inset-x-0 bottom-0 max-h-[75vh] overflow-y-auto rounded-t-2xl border-t data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom",
          side === "right" &&
            "inset-y-0 right-0 h-full w-72 border-l data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:animate-in data-[state=open]:slide-in-from-right",
          className,
        )}
        {...props}
      >
        <div className="flex items-center justify-between">
          <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
          <Dialog.Close className="flex size-9 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring">
            <X className="size-4" aria-hidden />
            <span className="sr-only">Close</span>
          </Dialog.Close>
        </div>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  );
}

export { Sheet, SheetTrigger, SheetContent };
