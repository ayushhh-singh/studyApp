import { useNavigate, useSearchParams } from "react-router";

/**
 * Generic "came from somewhere, go back there when done" support for every F6
 * tool player — used by a journey's exercise_ref step (blueprint F7: "opens
 * the actual exercise and returns on completion"). A tool page reached
 * normally (from the Tools grid) carries no `returnTo`, so `finish()` is a
 * no-op and every existing player behaves exactly as before.
 */
export function useToolReturnTo() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const returnTo = params.get("returnTo");
  const finish = () => {
    if (returnTo) navigate(returnTo);
  };
  return { returnTo, finish };
}
