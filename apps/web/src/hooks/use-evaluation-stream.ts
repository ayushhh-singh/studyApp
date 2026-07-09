import { useCallback, useEffect, useRef, useState } from "react";
import type { AnalysisEvent, DimensionScoreEvent, EvalDoneEvent, EvalStatusPhase, Locale } from "@prayasup/shared";
import { streamEvents } from "@/lib/sse";

const API_URL = import.meta.env.VITE_API_URL as string;

export interface EvaluationStreamState {
  phase: EvalStatusPhase | null;
  dimensions: DimensionScoreEvent[];
  analysis: AnalysisEvent | null;
  strengths: string;
  improvements: string;
  modelAnswer: string;
  done: EvalDoneEvent | null;
  error: string | null;
  isStreaming: boolean;
}

const INITIAL_STATE: EvaluationStreamState = {
  phase: null,
  dimensions: [],
  analysis: null,
  strengths: "",
  improvements: "",
  modelAnswer: "",
  done: null,
  error: null,
  isStreaming: false,
};

/**
 * Drives GET /stream/evaluations/:submissionId. The same reducer handles both
 * a live run (many small feedback_delta/model_answer_delta chunks) and a
 * replay (each arrives as one full-text event) — both just append to the
 * accumulated string, so no branching is needed for either case.
 *
 * `locale` is sent as `?locale=` so a replay in a locale OTHER than the one
 * the evaluation was generated in gets its feedback text translated
 * server-side (lazily, cached after the first view) instead of staying in
 * whatever language the answer was originally submitted in.
 */
export function useEvaluationStream(submissionId: string, locale: Locale) {
  const [state, setState] = useState<EvaluationStreamState>(INITIAL_STATE);
  const controllerRef = useRef<AbortController | null>(null);
  // Tracks which (submissionId, locale) pair this hook instance has already
  // opened a connection for. React StrictMode's dev-mode double-invoke runs
  // the mount effect twice with no cleanup in between, so an unguarded
  // start() opens a second concurrent SSE connection for the same replay —
  // which duplicated streamed feedback text (both connections append into
  // the same accumulator) and could surface a stale connection's error over
  // an already-successful result. Guarding on submissionId+locale makes the
  // automatic mount-triggered start idempotent while still re-fetching when
  // the viewer switches language; an explicit retry (force: true) always
  // reopens regardless.
  const startedIdRef = useRef<string | null>(null);
  // Monotonic id for the CURRENT connection attempt, bumped every time
  // start() actually proceeds past the dedupe guard above. This — NOT
  // controller.signal.aborted — is what onEvent/onError check to decide
  // whether they're still relevant. Reason: sse.ts's streamEvents() awaits
  // getAccessToken() before ever calling fetchEventSource(), and
  // fetchEventSource doesn't bind our external AbortSignal to its actual
  // in-flight request until that call happens (it only registers an
  // 'abort' listener on our signal at that point) — so calling
  // controllerRef.current?.abort() DURING that gap doesn't cancel anything;
  // the real request goes on to run as a "zombie" that's marked aborted on
  // our side but is genuinely still live. React StrictMode's dev-only
  // mount->cleanup->mount double-invoke hits this exactly: the unmount
  // cleanup below aborts the controller a moment after start() creates it
  // (before its fetch has even begun), and the guard above then blocks the
  // second mount's start() from opening a real replacement (same key) — so
  // this hook ends up depending on that zombie connection for its whole
  // lifetime. If it later fails, streamEvents' outer catch checks
  // `controller.signal.aborted`, sees it already true from the spurious
  // early abort, and silently swallows the error — the UI got stuck on the
  // loading spinner forever with no way to see the retry button. A
  // generation counter sidesteps the AbortController timing hole entirely:
  // it only advances when start() truly opens a NEW connection (a real
  // locale switch or an explicit force retry), so a stale callback is
  // recognized as stale by identity, not by a signal that can be flipped
  // before the request it's supposed to describe has even begun.
  const generationRef = useRef(0);

  const start = useCallback((opts?: { force?: boolean }) => {
    const key = `${submissionId}:${locale}`;
    if (!opts?.force && startedIdRef.current === key) return;
    startedIdRef.current = key;
    controllerRef.current?.abort();
    const generation = ++generationRef.current;
    setState({ ...INITIAL_STATE, isStreaming: true });
    controllerRef.current = streamEvents({
      url: `${API_URL}/api/v1/stream/evaluations/${submissionId}?locale=${locale}`,
      onEvent: (event, data) => {
        if (generation !== generationRef.current) return; // superseded by a newer connection — ignore
        setState((prev) => {
          switch (event) {
            case "status":
              return { ...prev, phase: (data as { phase: EvalStatusPhase }).phase };
            case "dimension_score": {
              // Idempotent by dimension key: a replay (or a re-run stream, e.g.
              // React StrictMode invoking the effect twice in dev) re-emits all
              // six, so replace-or-append rather than blindly accumulating.
              const dim = data as DimensionScoreEvent;
              const existing = prev.dimensions.findIndex((d) => d.key === dim.key);
              if (existing === -1) return { ...prev, dimensions: [...prev.dimensions, dim] };
              const next = prev.dimensions.slice();
              next[existing] = dim;
              return { ...prev, dimensions: next };
            }
            case "analysis":
              return { ...prev, analysis: data as AnalysisEvent };
            case "feedback_delta": {
              const { section, text } = data as { section: "strengths" | "improvements"; text: string };
              return section === "strengths"
                ? { ...prev, strengths: prev.strengths + text }
                : { ...prev, improvements: prev.improvements + text };
            }
            case "model_answer_delta":
              return { ...prev, modelAnswer: prev.modelAnswer + (data as { text: string }).text };
            case "done":
              return { ...prev, done: data as EvalDoneEvent, isStreaming: false };
            case "error":
              return { ...prev, error: (data as { message: string }).message, isStreaming: false };
            default:
              return prev;
          }
        });
      },
      onError: (err) => {
        if (generation !== generationRef.current) return; // superseded — the current connection owns error state now
        setState((prev) => ({
          ...prev,
          isStreaming: false,
          error: prev.error ?? (err instanceof Error ? err.message : "Evaluation stream failed"),
        }));
      },
    });
  }, [submissionId, locale]);

  // Abort an in-flight stream on unmount (e.g. navigating away mid-evaluation)
  // so the server-side sonnet calls it's driving stop billing tokens.
  //
  // NOTE (found during edge-case testing, deliberately NOT "fixed" here —
  // see the session notes for the full writeup): this abort() can itself be
  // silently ineffective. sse.ts's streamEvents() awaits getAccessToken()
  // before ever calling fetchEventSource(), and fetchEventSource doesn't
  // bind OUR AbortSignal to its actual in-flight request until that call
  // happens (it only attaches an 'abort' listener at that point) — so an
  // abort() fired during that gap doesn't cancel anything; the underlying
  // request runs on as a "zombie" that LOOKS aborted on our side
  // (controller.signal.aborted = true) but is genuinely still live. React
  // StrictMode's dev-only mount->cleanup->mount double-invoke hits this
  // exactly: this cleanup's abort() fires on the connection start() just
  // opened a moment earlier, before its fetch has even begun. If that
  // zombie connection later fails for a real reason (a dropped connection,
  // a backend restart), sse.ts's outer catch checks
  // `controller.signal.aborted`, sees it already (spuriously) true, and
  // never calls our onError — the hook is stuck on the loading spinner
  // forever with no retry option, since generationRef (above) doesn't help
  // here: nothing ever calls sse.ts's onError in the first place for this
  // gate to filter. The fix would need one of: (a) resetting startedIdRef
  // here so a genuine remount can open a fresh, properly-bound replacement
  // — but StrictMode's mount-pass-2 runs synchronously right after this
  // cleanup, so the replacement's fetch would race the original zombie
  // fetch for the server's one-concurrent-evaluation-per-user lock, and if
  // the REPLACEMENT loses that race (409), the hook would show an error
  // even though the original (now generation-stale, silently ignored)
  // connection is the one actually succeeding — trading a rare hang for a
  // rare spurious error, not a clean win; or (b) sse.ts itself not gating
  // onError by controller.signal.aborted (it isn't in this task's approved
  // file list). Confirmed via a live repro (killing the connection with
  // Playwright route interception before any response arrives) and
  // confirmed this is DEV-ONLY: StrictMode only double-invokes effects in
  // development, so production navigate-away-for-real never hits this gap
  // (nothing renders the stale hook instance's state afterward anyway).
  // Left unfixed and reported rather than shipping the (a) tradeoff blind.
  useEffect(() => () => controllerRef.current?.abort(), []);

  return { ...state, start };
}
