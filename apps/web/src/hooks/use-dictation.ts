import { useCallback, useEffect, useRef, useState } from "react";

// The Web Speech API's SpeechRecognition isn't in TS's DOM lib — declare just
// enough of its shape to use it, feature-detected at runtime.
interface SpeechRecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechRecognitionEvent {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResult>;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, SpeechRecognitionCtor | undefined>;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type DictationLocale = "hi-IN" | "en-IN";

/** Web Speech API dictation. Feature-detected — `isSupported` is false on browsers without it (most desktop Firefox, some mobile browsers). */
export function useDictation(onFinal: (text: string) => void) {
  const ctorRef = useRef(getSpeechRecognitionCtor());
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;
  const [isListening, setIsListening] = useState(false);
  const [interimText, setInterimText] = useState("");

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const start = useCallback((langCode: DictationLocale) => {
    const Ctor = ctorRef.current;
    if (!Ctor) return;
    recognitionRef.current?.stop();

    const recognition = new Ctor();
    recognition.lang = langCode;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript;
        if (result.isFinal) {
          onFinalRef.current(transcript);
        } else {
          interim += transcript;
        }
      }
      setInterimText(interim);
    };
    recognition.onend = () => {
      setIsListening(false);
      setInterimText("");
    };
    recognition.onerror = () => {
      setIsListening(false);
      setInterimText("");
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, []);

  // Stop dictation if the owning component unmounts mid-session.
  useEffect(() => () => recognitionRef.current?.stop(), []);

  return { isSupported: !!ctorRef.current, isListening, interimText, start, stop };
}
