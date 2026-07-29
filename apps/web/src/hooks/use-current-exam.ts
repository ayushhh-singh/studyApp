import { DEFAULT_EXAM_CODE, type Exam } from "@neev/shared";
import { useAuth } from "@/providers/auth-provider";
import { useProfile } from "@/hooks/use-profile";
import { useExams } from "@/hooks/use-exams";
import { useLocale } from "@/hooks/use-locale";
import { shortExamName } from "@/lib/exam-label";

/**
 * The exam the signed-in user is preparing for, resolved to its registry row.
 *
 * `users_profile.target_exam` has been in `profileSchema` since migration 0106
 * and arrives in every `GET /profile` response, but nothing on the client read
 * it — every exam-specific number and name in the UI was a literal instead.
 * This is the single place the client answers "which exam am I rendering for".
 *
 * Signed out (or guest-before-profile), it falls back to `DEFAULT_EXAM_CODE`
 * rather than fetching: the profile request would 401, and `uppsc` is what every
 * pre-0106 row backfilled to and the only `is_live` exam today. `exam` stays
 * null until the registry resolves, so a caller reading a paper structure must
 * handle "not loaded yet" — deliberately NOT papered over with a default
 * structure, because a borrowed structure is a wrong mark scale.
 *
 * `name` is safe to render immediately: it falls back to the short label for the
 * code while `exam` is still loading, so exam-named copy never flashes empty.
 */
export function useCurrentExam(): {
  examCode: string;
  exam: Exam | null;
  name: string;
  isLoading: boolean;
  /**
   * The registry request FAILED, so `exam` is null for a reason that is NOT
   * "this exam has nothing". Surfaced separately so a caller can say
   * "couldn't load" instead of silently rendering an absent/empty state.
   */
  isError: boolean;
} {
  const { session } = useAuth();
  const locale = useLocale();
  const { data: profile } = useProfile({ enabled: !!session });
  const { data: exams, isLoading: examsLoading, isError: examsError } = useExams();

  const examCode = profile?.target_exam ?? DEFAULT_EXAM_CODE;
  const exam = exams?.find((e) => e.exam_code === examCode) ?? null;

  return {
    examCode,
    exam,
    name: shortExamName(exam, locale, examCode),
    isLoading: examsLoading || (!!session && !profile),
    isError: examsError,
  };
}
