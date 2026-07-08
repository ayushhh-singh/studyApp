import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Sparkles, Loader2, Maximize2 } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui-x/sheet";
import { Button } from "@/components/ui/button";
import { useCreateThread } from "@/hooks/use-mentor";
import { useLocale } from "@/hooks/use-locale";
import { MentorChat } from "./mentor-chat";
import { cn } from "@/lib/utils";

/**
 * Floating "Ask mentor" launcher, shown on Learn / Practice / Answers. Opens a
 * right slide-over with a persistent session thread (created lazily on first
 * open, reused across opens). When launched from a Learn node page, retrieval is
 * scoped to that node's syllabus context.
 */
export function FloatingMentorButton() {
  const { t } = useTranslation();
  const locale = useLocale();
  const location = useLocation();
  const params = useParams<{ nodeId?: string }>();
  const [open, setOpen] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const createThread = useCreateThread();
  const creating = useRef(false);

  // Show only on the doubt-friendly surfaces (strip the /:locale prefix).
  const path = location.pathname.replace(/^\/[a-z]{2}(?=\/|$)/, "");
  const show = /^\/(learn|practice|answers)(\/|$)/.test(path) && !path.startsWith("/doubts");

  function attemptCreate() {
    if (creating.current) return;
    creating.current = true;
    createThread.mutate(undefined, {
      onSuccess: (thread) => setThreadId(thread.id),
      onSettled: () => {
        creating.current = false;
      },
    });
  }

  useEffect(() => {
    if (open && !threadId) attemptCreate();
    // attemptCreate is intentionally excluded — it's stable in behavior (guarded
    // by the creating ref) and including the mutation object would re-fire this
    // on every render of a new object reference, not just open/threadId changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, threadId]);

  if (!show) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("Mentor.askMentor")}
        className={cn(
          "fixed bottom-24 right-4 z-40 flex h-12 items-center gap-2 rounded-full bg-primary px-4 text-primary-foreground shadow-lg transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring md:bottom-6",
        )}
      >
        <Sparkles className="size-5" aria-hidden />
        <span className="text-sm font-semibold">{t("Mentor.askMentor")}</span>
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" title={t("Mentor.title")} className="w-[92vw] sm:w-[30rem]">
          {threadId ? (
            <div className="flex min-h-0 flex-1 flex-col gap-2">
              {/* Connects this quick, in-context chat to the full /doubts page
                  (thread history, delete, other conversations) — the two
                  entry points previously had no link between them at all. */}
              <Link
                to={`/${locale}/doubts/${threadId}`}
                onClick={() => setOpen(false)}
                className="flex items-center gap-1.5 self-end text-xs text-muted-foreground hover:text-foreground"
              >
                <Maximize2 className="size-3.5" aria-hidden />
                {t("Mentor.openFullConversation")}
              </Link>
              <MentorChat threadId={threadId} nodeId={params.nodeId} className="min-h-0 flex-1" />
            </div>
          ) : createThread.isError ? (
            // Previously there was no error path at all here — a failed thread
            // creation left this spinner spinning forever with no way to retry
            // short of closing and reopening the sheet (which wasn't hinted at
            // anywhere in the UI).
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-sm text-coral">{t("Mentor.threadCreateFailed")}</p>
              <Button type="button" variant="outline" size="sm" onClick={attemptCreate}>
                {t("Mentor.retry")}
              </Button>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
