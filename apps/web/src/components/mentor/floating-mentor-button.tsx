import { useEffect, useRef, useState } from "react";
import { useLocation, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Sparkles, Loader2 } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui-x/sheet";
import { useCreateThread } from "@/hooks/use-mentor";
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
  const location = useLocation();
  const params = useParams<{ nodeId?: string }>();
  const [open, setOpen] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const createThread = useCreateThread();
  const creating = useRef(false);

  // Show only on the doubt-friendly surfaces (strip the /:locale prefix).
  const path = location.pathname.replace(/^\/[a-z]{2}(?=\/|$)/, "");
  const show = /^\/(learn|practice|answers)(\/|$)/.test(path) && !path.startsWith("/doubts");

  useEffect(() => {
    if (open && !threadId && !creating.current) {
      creating.current = true;
      createThread.mutate(undefined, {
        onSuccess: (thread) => setThreadId(thread.id),
        onSettled: () => {
          creating.current = false;
        },
      });
    }
  }, [open, threadId, createThread]);

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
            <MentorChat threadId={threadId} nodeId={params.nodeId} />
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
