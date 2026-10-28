import { useEffect, useState } from "react";
import { loadPlaymatHintDismissed, savePlaymatHintDismissed } from "../../storage.js";

/** Settle in before suggesting anything: the board has just appeared. */
const PLAYMAT_HINT_DELAY_MS = 6000;

type HintState = "waiting" | "visible" | "done";

/** Offers the playmat picker once per account to players still on leather. */
export function usePlaymatHint({
  eligible,
  resolved,
  username,
  onChoose,
}: {
  /** A live seated game on the leather mat. */
  eligible: boolean;
  /** A mat has been chosen, so the hint has done its job. */
  resolved: boolean;
  username: string | null;
  onChoose: () => void;
}) {
  const [state, setState] = useState<HintState>(() => (
    loadPlaymatHintDismissed(localStorage, username) ? "done" : "waiting"
  ));

  useEffect(() => {
    if (state !== "waiting" || !eligible) return;
    const timer = setTimeout(() => setState("visible"), PLAYMAT_HINT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [eligible, state]);

  useEffect(() => {
    if (!resolved || state === "done") return;
    setState("done");
    savePlaymatHintDismissed(localStorage, username);
  }, [resolved, state, username]);

  const finish = () => {
    setState("done");
    savePlaymatHintDismissed(localStorage, username);
  };

  return {
    visible: state === "visible" && eligible,
    dismiss: finish,
    choose: () => {
      finish();
      onChoose();
    },
  };
}
