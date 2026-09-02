import { useEffect, useId, useRef, type ReactNode } from "react";
import { useIntl } from "react-intl";

const FOCUSABLE = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/** Accessible modal on laptops and bottom sheet on phone viewports. */
export function ModalSurface({
  title,
  onClose,
  children,
  className = "",
  description,
}: {
  title: string;
  onClose: () => void;
  children?: ReactNode;
  className?: string;
  description?: string;
}) {
  const intl = useIntl();
  const titleId = useId();
  const descriptionId = useId();
  const backdropRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const backdrop = backdropRef.current;
    const panel = panelRef.current;
    if (!backdrop || !panel) return;

    const surface = backdrop.closest<HTMLElement>(".table, .lobby-page, .prep-page");
    const siblings = new Set([
      ...(backdrop.parentElement?.children ?? []),
      ...(surface?.children ?? []),
    ].filter((node): node is HTMLElement =>
      node instanceof HTMLElement && node !== backdrop && !node.contains(backdrop)
    ));
    const previousInert = new Map([...siblings].map((sibling) => [sibling, sibling.inert]));
    for (const sibling of siblings) sibling.inert = true;

    const mobile = window.matchMedia("(max-width: 700px)").matches;
    const initial = mobile
      ? panel
      : panel.querySelector<HTMLElement>("[data-modal-initial-focus]") ??
        panel.querySelector<HTMLElement>(FOCUSABLE) ?? panel;
    initial.focus();

    return () => {
      for (const [sibling, inert] of previousInert) sibling.inert = inert;
      previousFocus?.focus();
    };
  }, []);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !panelRef.current) return;
    const focusable = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (focusable.length === 0) {
      event.preventDefault();
      panelRef.current.focus();
      return;
    }
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      ref={backdropRef}
      className="modal-backdrop modal-surface-backdrop"
      onClick={onClose}
    >
      <section
        ref={panelRef}
        className={`modal-surface ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <header className="modal-surface-header">
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className="modal-surface-close"
            aria-label={intl.formatMessage({ id: "common.closeNamed" }, { title })}
            onClick={onClose}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M6 6 18 18M18 6 6 18" />
            </svg>
          </button>
        </header>
        {description ? <p id={descriptionId} className="modal-surface-description">{description}</p> : null}
        {children}
      </section>
    </div>
  );
}
