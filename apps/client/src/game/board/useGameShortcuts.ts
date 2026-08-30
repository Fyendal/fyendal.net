import { useEffect } from "react";
import type { GameIntent, PendingDecision } from "@fyendal/shared";
import type { ActionStep } from "../useActionAnnouncement.js";
import {
  actionConfirmationHotkey,
  shouldConfirmArsenalPass,
  shouldPassOnSpace,
} from "../passHotkey.js";

export function useGameShortcuts({
  passEnabled,
  hotkeyIntent,
  pendingDecision,
  setConfirmArsenalSkip,
  onSend,
  onReset,
  confirmationEnabled,
  actionStep,
  onConfirmAction,
  onConfirmChainClose,
}: {
  passEnabled: boolean;
  hotkeyIntent: GameIntent | null;
  pendingDecision: PendingDecision | null;
  setConfirmArsenalSkip: (confirmed: boolean) => void;
  onSend: (intent: GameIntent) => boolean;
  onReset: () => void;
  confirmationEnabled: boolean;
  actionStep: ActionStep;
  onConfirmAction: () => void;
  onConfirmChainClose: () => void;
}): void {
  useEffect(() => {
    if (!passEnabled || !hotkeyIntent) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!shouldPassOnSpace(event)) return;
      event.preventDefault();
      if (shouldConfirmArsenalPass(pendingDecision, hotkeyIntent)) {
        setConfirmArsenalSkip(true);
        return;
      }
      if (onSend(hotkeyIntent)) onReset();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hotkeyIntent, onReset, onSend, passEnabled, pendingDecision, setConfirmArsenalSkip]);

  useEffect(() => {
    if (!confirmationEnabled || actionStep === "method") return;
    const onKeyDown = (event: KeyboardEvent) => {
      const result = actionConfirmationHotkey(event, actionStep, true);
      if (!result) return;
      event.preventDefault();
      if (result === "confirm-chain-close") onConfirmChainClose();
      else onConfirmAction();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [actionStep, confirmationEnabled, onConfirmAction, onConfirmChainClose]);
}
