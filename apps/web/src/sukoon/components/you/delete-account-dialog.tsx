/**
 * Sukoon F12 — irreversible "delete my account" confirmation. Clones the repo's
 * radix Dialog idiom (leave-confirm-dialog.tsx) and adds a type-to-confirm guard
 * (the user must type the confirm word) — the strongest destructive-action
 * pattern in the app, warranted because this schedules erasure of the account.
 */
import { useState } from "react";
import { Dialog } from "radix-ui";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";

export function DeleteAccountDialog({
  open,
  onOpenChange,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  const { t, language } = useSukoonLanguage();
  const [typed, setTyped] = useState("");
  const confirmWord = t("Sukoon.privacy.delete.confirmWord");
  const matches = typed.trim().toUpperCase() === confirmWord.toUpperCase();

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) setTyped("");
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          lang={language}
          className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-6 shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95"
        >
          <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="size-5 text-destructive" aria-hidden />
          </div>
          <Dialog.Title className="text-lg font-semibold text-foreground">
            {t("Sukoon.privacy.delete.dialogTitle")}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {t("Sukoon.privacy.delete.dialogBody")}
          </Dialog.Description>

          <label className="mt-5 block text-sm font-medium text-foreground">
            {t("Sukoon.privacy.delete.typePrompt", { word: confirmWord })}
          </label>
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoFocus
            autoComplete="off"
            aria-label={t("Sukoon.privacy.delete.typePrompt", { word: confirmWord })}
            className="mt-2"
          />

          <div className="mt-6 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button type="button" variant="outline">
                {t("Sukoon.privacy.delete.cancel")}
              </Button>
            </Dialog.Close>
            <Button
              type="button"
              variant="destructive"
              disabled={!matches || pending}
              onClick={onConfirm}
            >
              {pending ? t("Sukoon.privacy.delete.deleting") : t("Sukoon.privacy.delete.confirm")}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
