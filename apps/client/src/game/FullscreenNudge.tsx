import { useState } from "react";
import { createPortal } from "react-dom";
import { useIntl } from "react-intl";
import { useFullscreen } from "../components/useFullscreen.js";
import { ModalSurface } from "../components/ModalSurface.js";
import { UiIcon } from "../components/UiIcon.js";
import { loadFullscreenNudgeSeen, saveFullscreenNudgeSeen } from "../storage.js";

function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function launchedFromHomeScreen(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches
    || (navigator as { standalone?: boolean }).standalone === true;
}

/** iPhone Safari has no document full screen; a Home Screen launch is the only way. */
function homeScreenOnly(): boolean {
  return typeof navigator !== "undefined" && /iPhone|iPod/.test(navigator.userAgent);
}

/** Phone landscape: fills the control bar's gap between the two player plates. */
export function FullscreenNudge() {
  const intl = useIntl();
  const fullscreen = useFullscreen();
  const [installed] = useState(launchedFromHomeScreen);
  const [viaHomeScreen] = useState(() => !fullscreen.supported && homeScreenOnly());
  const [seen, setSeen] = useState(() => {
    const storage = browserStorage();
    return storage ? loadFullscreenNudgeSeen(storage) : false;
  });
  const [showSteps, setShowSteps] = useState(false);
  if (installed || fullscreen.active || !(fullscreen.supported || viaHomeScreen)) return null;

  const remember = () => {
    const storage = browserStorage();
    if (storage) saveFullscreenNudgeSeen(storage);
    setSeen(true);
  };
  const go = () => {
    remember();
    if (viaHomeScreen) setShowSteps(true);
    else fullscreen.toggle();
  };
  const goLabel = intl.formatMessage({
    id: viaHomeScreen ? "game.fullscreen.nudge.howTo" : "game.fullscreen.nudge.enter",
  });
  const pill = (
    <button type="button" className="fullscreen-well-pill" onClick={go}>
      <UiIcon name="fullscreen" />
      {intl.formatMessage({ id: "game.fullscreen.nudge.enter" })}
    </button>
  );

  return (
    <section
      className="fullscreen-well"
      aria-label={intl.formatMessage({ id: "game.fullscreen.nudge.title" })}
    >
      {seen ? pill : (
        <>
          <div className="fullscreen-well-card">
            <h2>{intl.formatMessage({ id: "game.fullscreen.nudge.title" })}</h2>
            <button type="button" className="fullscreen-well-go" onClick={go}>
              <UiIcon name="fullscreen" />
              {goLabel}
            </button>
            <button type="button" className="fullscreen-well-later" onClick={remember}>
              {intl.formatMessage({ id: "game.fullscreen.nudge.later" })}
            </button>
          </div>
          {/* A well too short for the card keeps just the button. */}
          {pill}
        </>
      )}
      {/* The rail is its own stacking context, so the sheet mounts on the body. */}
      {showSteps ? createPortal(
        <ModalSurface
          title={intl.formatMessage({ id: "game.fullscreen.homeScreen.title" })}
          description={intl.formatMessage({ id: "game.fullscreen.homeScreen.body" })}
          className="fullscreen-steps-sheet"
          onClose={() => setShowSteps(false)}
        >
          <ol className="fullscreen-steps">
            <li>{intl.formatMessage({ id: "game.fullscreen.homeScreen.step.share" })}</li>
            <li>{intl.formatMessage({ id: "game.fullscreen.homeScreen.step.add" })}</li>
            <li>{intl.formatMessage({ id: "game.fullscreen.homeScreen.step.open" })}</li>
          </ol>
          <button type="button" className="fullscreen-steps-done" onClick={() => setShowSteps(false)}>
            {intl.formatMessage({ id: "common.done" })}
          </button>
        </ModalSurface>,
        document.body,
      ) : null}
    </section>
  );
}
