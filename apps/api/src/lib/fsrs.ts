/**
 * FSRS scheduling, via ts-fsrs (see package.json for the pinned version —
 * also recorded in CLAUDE.md). The DB stores the scheduler's Card state as
 * plain jsonb on srs_cards.fsrs_state (see migration 0010/0048); this module
 * is the only place that converts between that jsonb shape and ts-fsrs's own
 * Card type, and the only place the FSRS algorithm itself is invoked.
 *
 * The `due_at` key name is load-bearing: the existing srs_cards_due_idx
 * (0010) and daily-progress.ts's due-count query both filter on
 * `fsrs_state ->> 'due_at'` — this module must keep writing that exact key.
 */
import { createEmptyCard, fsrs, generatorParameters, State, type Card, type Grade } from "ts-fsrs";

const scheduler = fsrs(generatorParameters({ enable_fuzz: false }));

export interface FsrsStateJson {
  due_at: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: string | null;
}

export type SrsRating = 1 | 2 | 3 | 4;

export interface RatingPreview {
  due_at: string;
  interval_days: number;
}

function toCard(json: FsrsStateJson | null | undefined, now: Date): Card {
  if (!json || !json.due_at) return createEmptyCard(now);
  return {
    due: new Date(json.due_at),
    stability: json.stability,
    difficulty: json.difficulty,
    elapsed_days: json.elapsed_days,
    scheduled_days: json.scheduled_days,
    learning_steps: json.learning_steps,
    reps: json.reps,
    lapses: json.lapses,
    state: json.state as State,
    last_review: json.last_review ? new Date(json.last_review) : undefined,
  };
}

function toJson(card: Card): FsrsStateJson {
  return {
    due_at: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state as number,
    last_review: card.last_review ? card.last_review.toISOString() : null,
  };
}

/** Apply a 1-4 (Again/Hard/Good/Easy) rating and return the rescheduled state + this review's log fields. */
export function reviewCard(
  currentState: FsrsStateJson | null | undefined,
  rating: SrsRating,
  now: Date = new Date(),
): { state: FsrsStateJson; elapsed_days: number; scheduled_days: number } {
  const card = toCard(currentState, now);
  const { card: nextCard, log } = scheduler.next(card, now, rating as Grade);
  return { state: toJson(nextCard), elapsed_days: log.elapsed_days, scheduled_days: log.scheduled_days };
}

/** Preview the next due date for all four ratings without committing a review — for the "rate" buttons' interval hints. */
export function previewIntervals(
  currentState: FsrsStateJson | null | undefined,
  now: Date = new Date(),
): Record<SrsRating, RatingPreview> {
  const card = toCard(currentState, now);
  const preview = {} as Record<SrsRating, RatingPreview>;
  for (const item of scheduler.repeat(card, now)) {
    preview[item.log.rating as SrsRating] = {
      due_at: item.card.due.toISOString(),
      interval_days: item.log.scheduled_days,
    };
  }
  return preview;
}
