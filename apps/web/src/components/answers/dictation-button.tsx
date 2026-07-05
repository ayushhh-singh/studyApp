import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Mic, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDictation, type DictationLocale } from "@/hooks/use-dictation";
import { cn } from "@/lib/utils";

/** Web Speech API dictation. Renders nothing on browsers without support (feature-detected). */
export function DictationButton({ onFinal }: { onFinal: (text: string) => void }) {
  const { t } = useTranslation();
  const [lang, setLang] = useState<DictationLocale>("en-IN");
  const { isSupported, isListening, interimText, start, stop } = useDictation(onFinal);

  if (!isSupported) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-full border border-border text-xs">
          <button
            type="button"
            onClick={() => setLang("hi-IN")}
            disabled={isListening}
            className={cn("px-2.5 py-1 font-medium", lang === "hi-IN" ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
          >
            हिं
          </button>
          <button
            type="button"
            onClick={() => setLang("en-IN")}
            disabled={isListening}
            className={cn("px-2.5 py-1 font-medium", lang === "en-IN" ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
          >
            EN
          </button>
        </div>
        <Button
          type="button"
          variant={isListening ? "destructive" : "outline"}
          size="sm"
          onClick={() => (isListening ? stop() : start(lang))}
        >
          {isListening ? <Square aria-hidden /> : <Mic aria-hidden />}
          {isListening ? t("Answers.dictationStop") : t("Answers.dictationStart")}
        </Button>
      </div>
      {isListening && (
        <p className="text-xs italic text-muted-foreground" lang={lang === "hi-IN" ? "hi" : "en"}>
          {interimText || t("Answers.dictationListening")}
        </p>
      )}
    </div>
  );
}
