import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ReportReason, ReportTargetType } from "@prayasup/shared";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui-x/sheet";
import { Button } from "@/components/ui/button";
import { useReportContent } from "@/hooks/use-community";
import { Flag } from "lucide-react";

const REASONS: ReportReason[] = ["spam", "abuse", "harassment", "off_topic", "pii", "other"];

/** Small reason-picker sheet behind a flag icon — used on every post/thread. */
export function ReportSheet({ targetType, targetId }: { targetType: ReportTargetType; targetId: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason>("spam");
  const [detail, setDetail] = useState("");
  const report = useReportContent();

  const submit = () => {
    report.mutate(
      { target_type: targetType, target_id: targetId, reason, detail: detail.trim() || undefined },
      { onSuccess: () => setOpen(false) },
    );
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) report.reset();
      }}
    >
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label={t("Community.report")}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Flag className="size-3.5" aria-hidden />
        </button>
      </SheetTrigger>
      <SheetContent side="bottom" title={t("Community.reportTitle")}>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {t("Community.reportReasonLabel")}
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as ReportReason)}
              className="h-11 rounded-xl border border-input bg-background px-3.5 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {REASONS.map((r) => (
                <option key={r} value={r}>
                  {t(`Community.reportReason.${r}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {t("Community.reportDetailLabel")}
            <textarea
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              rows={3}
              maxLength={500}
              className="rounded-xl border border-input bg-background px-3.5 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </label>
          {report.error && <p className="text-sm text-coral">{report.error.message}</p>}
          <Button onClick={submit} disabled={report.isPending}>
            {t("Community.reportSubmit")}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
