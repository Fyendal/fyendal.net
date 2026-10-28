import { useEffect, useMemo, useState } from "react";
import type { SeatStandingOrders } from "@fyendal/shared";
import {
  applyStandingOrder,
  loadGameSettings,
  saveGameSettings,
  type CardDisplayPreference,
  type MotionPreference,
  type PlayabilityCuePreference,
  type PriorityWindowMode,
  type StandingOrderUpdate,
} from "../../storage.js";
import type { PlaymatId } from "../../playmats.js";

export function useGameSettings({
  syncPriorityMode,
  sendPriorityMode,
  sendStandingOrders,
}: {
  syncPriorityMode: boolean;
  sendPriorityMode: (mode: PriorityWindowMode) => void;
  sendStandingOrders: (orders: SeatStandingOrders) => void;
}) {
  const [settings, setSettings] = useState(() => loadGameSettings(localStorage));

  useEffect(() => {
    if (syncPriorityMode) sendPriorityMode(settings.priorityWindowMode);
  }, [sendPriorityMode, settings.priorityWindowMode, syncPriorityMode]);

  // Resent on every reconnect.
  useEffect(() => {
    if (syncPriorityMode) sendStandingOrders(settings.standingOrders);
  }, [sendStandingOrders, settings.standingOrders, syncPriorityMode]);

  const updatePriorityWindowMode = (mode: PriorityWindowMode) => {
    setSettings((current) => {
      const next = { ...current, priorityWindowMode: mode };
      saveGameSettings(localStorage, next);
      return next;
    });
    sendPriorityMode(mode);
  };
  const updateLessGuidance = (enabled: boolean) => {
    setSettings((current) => {
      const next = { ...current, lessGuidance: enabled };
      saveGameSettings(localStorage, next);
      return next;
    });
  };
  const updateSkipPlayConfirmation = (enabled: boolean) => {
    setSettings((current) => {
      const next = { ...current, skipPlayConfirmation: enabled };
      saveGameSettings(localStorage, next);
      return next;
    });
  };
  const updateOptionHotkeys = (optionHotkeys: boolean) => {
    setSettings((current) => {
      const next = { ...current, optionHotkeys };
      saveGameSettings(localStorage, next);
      return next;
    });
  };
  const updateSkipBotDelay = (skipBotDelay: boolean) => {
    setSettings((current) => {
      const next = { ...current, skipBotDelay };
      saveGameSettings(localStorage, next);
      return next;
    });
  };
  const updateCardDisplayPreference = (cardDisplayPreference: CardDisplayPreference) => {
    setSettings((current) => {
      const next = { ...current, cardDisplayPreference };
      saveGameSettings(localStorage, next);
      return next;
    });
  };
  const updateMotionPreference = (motionPreference: MotionPreference) => {
    setSettings((current) => {
      const next = { ...current, motionPreference };
      saveGameSettings(localStorage, next);
      return next;
    });
  };
  const updatePlayabilityCuePreference = (
    playabilityCuePreference: PlayabilityCuePreference,
  ) => {
    setSettings((current) => {
      const next = { ...current, playabilityCuePreference };
      saveGameSettings(localStorage, next);
      return next;
    });
  };
  const updateSoundEffectsEnabled = (soundEffectsEnabled: boolean) => {
    setSettings((current) => {
      const next = { ...current, soundEffectsEnabled };
      saveGameSettings(localStorage, next);
      return next;
    });
  };
  const updateSoundEffectsVolume = (soundEffectsVolume: number) => {
    setSettings((current) => {
      const next = { ...current, soundEffectsVolume };
      saveGameSettings(localStorage, next);
      return next;
    });
  };

  const updatePlaymat = (playmat: PlaymatId) => {
    setSettings((current) => {
      const next = { ...current, playmat };
      saveGameSettings(localStorage, next);
      return next;
    });
  };

  const updateStandingOrder = (key: string, update: StandingOrderUpdate) => {
    setSettings((current) => {
      const standingOrders = applyStandingOrder(current.standingOrders, key, update);
      if (standingOrders === current.standingOrders) return current;
      const next = { ...current, standingOrders };
      saveGameSettings(localStorage, next);
      return next;
    });
  };

  return {
    ...settings,
    updatePriorityWindowMode,
    updateLessGuidance,
    updateSkipPlayConfirmation,
    updateOptionHotkeys,
    updateSkipBotDelay,
    updateCardDisplayPreference,
    updateMotionPreference,
    updatePlayabilityCuePreference,
    updateSoundEffectsEnabled,
    updateSoundEffectsVolume,
    updatePlaymat,
    updateStandingOrder,
  };
}
