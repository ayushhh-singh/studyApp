import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { BilingualText } from "@neev/shared";
import { Button } from "@/components/ui/button";

const TEXTAREA_CLASS =
  "min-h-16 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function CardForm({
  initial,
  onSave,
  onCancel,
  isSaving,
}: {
  initial?: { front_i18n: BilingualText; back_i18n: BilingualText };
  onSave: (body: { front_i18n: BilingualText; back_i18n: BilingualText }) => void;
  onCancel: () => void;
  isSaving?: boolean;
}) {
  const { t } = useTranslation();
  const [frontEn, setFrontEn] = useState(initial?.front_i18n.en ?? "");
  const [frontHi, setFrontHi] = useState(initial?.front_i18n.hi ?? "");
  const [backEn, setBackEn] = useState(initial?.back_i18n.en ?? "");
  const [backHi, setBackHi] = useState(initial?.back_i18n.hi ?? "");
  const canSave = (frontEn.trim() || frontHi.trim()) && (backEn.trim() || backHi.trim());

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-dashed border-border bg-muted/40 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">{t("Revision.frontEn")}</label>
          <textarea className={TEXTAREA_CLASS} value={frontEn} onChange={(e) => setFrontEn(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">{t("Revision.frontHi")}</label>
          <textarea className={TEXTAREA_CLASS} value={frontHi} onChange={(e) => setFrontHi(e.target.value)} />
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">{t("Revision.backEn")}</label>
          <textarea className={TEXTAREA_CLASS} value={backEn} onChange={(e) => setBackEn(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">{t("Revision.backHi")}</label>
          <textarea className={TEXTAREA_CLASS} value={backHi} onChange={(e) => setBackHi(e.target.value)} />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={isSaving}>
          {t("Revision.cancel")}
        </Button>
        <Button
          size="sm"
          disabled={!canSave || isSaving}
          onClick={() =>
            onSave({
              front_i18n: { en: frontEn.trim(), hi: frontHi.trim() },
              back_i18n: { en: backEn.trim(), hi: backHi.trim() },
            })
          }
        >
          {t("Revision.save")}
        </Button>
      </div>
    </div>
  );
}
