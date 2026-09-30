import { useEffect, useState } from "react";

export function useFullscreen() {
  const supported = typeof document !== "undefined"
    && typeof document.documentElement.requestFullscreen === "function"
    && typeof document.exitFullscreen === "function";
  const [active, setActive] = useState(() => supported
    && document.fullscreenElement === document.documentElement);

  useEffect(() => {
    if (!supported) return;
    const sync = () => setActive(document.fullscreenElement === document.documentElement);
    document.addEventListener("fullscreenchange", sync);
    sync();
    return () => document.removeEventListener("fullscreenchange", sync);
  }, [supported]);

  const toggle = () => {
    if (!supported) return;
    const request = document.fullscreenElement === document.documentElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen();
    void request.catch(() => {});
  };

  return { supported, active, toggle };
}
