import { useTranslation } from "react-i18next";
import { CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";
import type { SubmissionStatus } from "@prayasup/shared";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<SubmissionStatus, { icon: typeof Clock; className: string; labelKey: string }> = {
  pending: { icon: Clock, className: "bg-muted text-muted-foreground", labelKey: "Answers.statusPending" },
  ocr_processing: {
    icon: Loader2,
    className: "bg-marigold/15 text-marigold-foreground",
    labelKey: "Answers.statusTranscribing",
  },
  ocr_done: { icon: Clock, className: "bg-muted text-muted-foreground", labelKey: "Answers.statusPending" },
  evaluating: {
    icon: Loader2,
    className: "bg-marigold/15 text-marigold-foreground",
    labelKey: "Answers.statusEvaluating",
  },
  complete: { icon: CheckCircle2, className: "bg-tulsi/15 text-tulsi-foreground", labelKey: "Answers.statusComplete" },
  failed: { icon: XCircle, className: "bg-coral/15 text-coral-foreground", labelKey: "Answers.statusFailed" },
};

export function SubmissionStatusChip({ status }: { status: SubmissionStatus }) {
  const { t } = useTranslation();
  const style = STATUS_STYLE[status];
  const Icon = style.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", style.className)}>
      <Icon className={cn("size-3.5", (status === "evaluating" || status === "ocr_processing") && "animate-spin")} aria-hidden />
      {t(style.labelKey)}
    </span>
  );
}
