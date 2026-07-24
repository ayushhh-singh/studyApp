/** Pins/unpins one exercise's audio for offline playback (max 5 — see sukoon-audio-cache.ts). */
import { useEffect, useState } from "react";
import { Pin, PinOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { isPinned, pinAudio, pinKey, unpinAudio } from "@/sukoon/lib/sukoon-audio-cache";

export function PinAudioButton({
  exerciseId,
  lang,
  label,
  signedUrl,
}: {
  exerciseId: string;
  lang: "hi" | "en";
  label: string;
  signedUrl: string | null;
}) {
  const { t } = useSukoonLanguage();
  const key = pinKey(exerciseId, lang);
  const [pinned, setPinned] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    isPinned(key).then((v) => {
      if (!cancelled) setPinned(v);
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  if (pinned === null) return null;

  const toggle = async () => {
    setBusy(true);
    try {
      if (pinned) {
        await unpinAudio(key);
        setPinned(false);
      } else if (signedUrl) {
        await pinAudio(key, label, signedUrl);
        setPinned(true);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => void toggle()}
      disabled={busy || (!pinned && !signedUrl)}
      className="gap-1.5 text-muted-foreground"
    >
      {pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
      {pinned ? t("Sukoon.tools.unpinOffline") : t("Sukoon.tools.pinOffline")}
    </Button>
  );
}
