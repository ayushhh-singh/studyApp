import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useAddPost } from "@/hooks/use-community";
import { useAuth } from "@/providers/auth-provider";
import { usePaywallStore } from "@/stores/paywall-store";

export function PostComposer({ threadId, disabled }: { threadId: string; disabled?: boolean }) {
  const { t } = useTranslation();
  const [body, setBody] = useState("");
  const addPost = useAddPost(threadId);
  const { isGuest } = useAuth();
  const openPaywall = usePaywallStore((s) => s.openPaywall);

  if (disabled) {
    return <p className="rounded-lg border border-dashed border-border p-3 text-center text-sm text-muted-foreground">{t("Community.threadLocked")}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={t("Community.replyPlaceholder")}
        rows={3}
        maxLength={5000}
        className="rounded-xl border border-input bg-background px-3.5 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      />
      {addPost.error && <p className="text-sm text-coral">{addPost.error.message}</p>}
      <Button
        size="sm"
        className="self-end"
        disabled={addPost.isPending || !body.trim()}
        onClick={() => {
          if (isGuest) return openPaywall("generic");
          addPost.mutate({ body: body.trim() }, { onSuccess: () => setBody("") });
        }}
      >
        {t("Community.postReply")}
      </Button>
    </div>
  );
}
