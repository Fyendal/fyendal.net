import { useEffect, useState } from "react";
import {
  loadGameSettings,
  saveGameSettings,
  type MotionPreference,
  type PlayabilityCuePreference,
  type PriorityWindowMode,
} from "../../storage.js";

export function useGameSettings({
  syncPriorityMode,
  sendPriorityMode,
}: {
  syncPriorityMode: boolean;
  sendPriorityMode: (mode: PriorityWindowMode) => void;
}) {
  const [settings, setSettings] = useState(() => loadGameSettings(localStorage));

  useEffect(() => {
    if (syncPriorityMode) sendPriorityMode(settings.priorityWindowMode);
  }, [sendPriorityMode, settings.priorityWindowMode, syncPriorityMode]);

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

  return {
    ...settings,
    updatePriorityWindowMode,
    updateLessGuidance,
    updateSkipPlayConfirmation,
    updateMotionPreference,
    updatePlayabilityCuePreference,
    updateSoundEffectsEnabled,
    updateSoundEffectsVolume,
  };
}
