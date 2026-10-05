import { useState } from "react";
import {
  opponentPlayPresentation,
  type OpponentPlayInput,
  type OpponentPlayPresentation,
} from "./opponentPlayPresentation.js";

export function useOpponentPlayPresentation(input: OpponentPlayInput): OpponentPlayPresentation {
  const [presentation, setPresentation] = useState(() => opponentPlayPresentation(null, input));
  const previous = presentation.input;
  if (previous.view !== input.view || previous.update !== input.update
    || previous.viewerSeat !== input.viewerSeat || previous.enabled !== input.enabled
    || previous.scope !== input.scope) {
    const next = opponentPlayPresentation(presentation, input);
    // Adjust before committing children so a payment snapshot cannot flash or
    // enter the motion baseline for one frame before it is deferred.
    setPresentation(next);
    return next;
  }
  return presentation;
}
