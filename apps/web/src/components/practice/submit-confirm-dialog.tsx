import { Dialog } from "radix-ui";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

export function SubmitConfirmDialog({
  open,
  onOpenChange,
  unansweredCount,
  onConfirm,
  isSubmitting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  unansweredCount: number;
  onConfirm: () => void;
  isSubmitting: boolean;
}) {
  const { t } = useTranslation();

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-5 shadow-2xl outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:animate-in data-[state=open]:fade-in">
          <Dialog.Title className="text-base font-semibold">{t("Practice.submitConfirmTitle")}</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-muted-foreground">
            {unansweredCount > 0
              ? t("Practice.submitConfirmUnanswered", { count: unansweredCount })
              : t("Practice.submitConfirmAllAnswered")}
          </Dialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button type="button" variant="outline">
                {t("Practice.submitConfirmCancel")}
              </Button>
            </Dialog.Close>
            <Button type="button" onClick={onConfirm} disabled={isSubmitting}>
              {isSubmitting ? t("Practice.submitting") : t("Practice.submitConfirmCta")}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
