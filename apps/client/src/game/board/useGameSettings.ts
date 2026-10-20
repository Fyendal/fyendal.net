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
  type StandingOrders,
  type StandingOrderUpdate,
} from "../../storage.js";

/** The decided answers only; "ask" is the absence of an order. */
export function toSeatStandingOrders(orders: StandingOrders): SeatStandingOrders {
  const seat: SeatStandingOrders = {};
  for (const [key, order] of Object.entries(orders)) {
    const entry: SeatStandingOrders[string] = {};
    if (order.priorityWindow === "pass") entry.priorityWindow = "pass";
    if (order.optionalTrigger === "yes" || order.optionalTrigger === "no") entry.optionalTrigger = order.optionalTrigger;
    if (entry.priorityWindow !== undefined || entry.optionalTrigger !== undefined) seat[key] = entry;
  }
  return seat;
}

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

  const seatOrders = useMemo(() => toSeatStandingOrders(settings.standingOrders), [settings.standingOrders]);
  useEffect(() => {
    if (syncPriorityMode) sendStandingOrders(seatOrders);
  }, [seatOrders, sendStandingOrders, syncPriorityMode]);

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
    updateCardDisplayPreference,
    updateMotionPreference,
    updatePlayabilityCuePreference,
    updateSoundEffectsEnabled,
    updateSoundEffectsVolume,
    updateStandingOrder,
  };
}
