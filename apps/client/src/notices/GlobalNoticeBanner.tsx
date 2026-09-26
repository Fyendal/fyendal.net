import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStore } from "../store.js";
import { startNoticePolling } from "./polling.js";
import { NoticeBanner } from "./NoticeBanner.js";

export function GlobalNoticeBanner() {
  const notice = useStore((state) => state.globalNotice);
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const visible = notice !== null && notice.id !== dismissedId;
  useEffect(() => startNoticePolling((globalNotice) => useStore.setState({ globalNotice })), []);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const measure = () => root.style.setProperty("--global-notice-height", `${container.current?.getBoundingClientRect().height ?? 0}px`);
    measure();
    const observer = new ResizeObserver(measure);
    if (container.current) observer.observe(container.current);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--global-notice-height");
    };
  }, [visible]);
  return (
    <div ref={container} className="global-notice-container">
      {visible ? <NoticeBanner notice={notice} onDismiss={() => setDismissedId(notice.id)} /> : null}
    </div>
  );
}
