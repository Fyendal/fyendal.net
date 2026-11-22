import { useIntl } from "react-intl";
import { ModalSurface } from "../components/ModalSurface.js";
import type { SandboxEditRefusal } from "../store/types.js";
import { SANDBOX_REFUSAL_MESSAGE } from "./SandboxPanel.js";

/** Asked before a bot game's first sandbox edit, which stops it counting. */
export function SandboxConvertConfirm({
  sending,
  refusal,
  onConfirm,
  onCancel,
}: {
  /** The converting edit is in flight; the dialog closes once the room is sandbox. */
  sending: boolean;
  refusal: SandboxEditRefusal | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const intl = useIntl();
  const busy = sending && !refusal;
  return (
    <ModalSurface
      title={intl.formatMessage({ id: "game.sandbox.convert.title" })}
      description={intl.formatMessage({ id: "game.sandbox.convert.description" })}
      className="sandbox-sheet deck-reveal-sheet"
      onClose={onCancel}
    >
      {refusal ? (
        <p className="sandbox-refusal" role="alert">
          {intl.formatMessage({ id: SANDBOX_REFUSAL_MESSAGE[refusal] })}
        </p>
      ) : null}
      <div className="sandbox-actions">
        <button type="button" className="sandbox-reset" onClick={onCancel}>
          {intl.formatMessage({ id: "common.cancel" })}
        </button>
        <button type="button" className="btn-primary" data-modal-initial-focus disabled={busy} onClick={onConfirm}>
          {intl.formatMessage({ id: busy ? "game.sandbox.convert.confirming" : "game.sandbox.convert.confirm" })}
        </button>
      </div>
    </ModalSurface>
  );
}
