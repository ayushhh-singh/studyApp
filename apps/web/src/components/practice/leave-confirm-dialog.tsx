import { Dialog } from "radix-ui";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

/**
 * Guards the exam-mode test player against silently abandoning an unsubmitted
 * attempt — via the header X button, browser back/forward, or any other
 * in-app navigation intercepted by test-player.tsx's useBlocker. Confirming
 * lets the original navigation proceed; canceling stays on the current
 * question with no state lost.
 */
export function LeaveConfirmDialog({
  open,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-5 shadow-2xl outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:animate-in data-[state=open]:fade-in">
          <Dialog.Title className="text-base font-semibold">{t("Practice.leaveConfirmTitle")}</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-muted-foreground">
            {t("Practice.leaveConfirmDescription")}
          </Dialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onCancel}>
              {t("Practice.leaveConfirmStay")}
            </Button>
            <Button type="button" variant="destructive" onClick={onConfirm}>
              {t("Practice.leaveConfirmLeave")}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
