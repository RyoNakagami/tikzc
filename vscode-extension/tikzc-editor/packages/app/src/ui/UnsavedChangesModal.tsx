import { Modal } from "./Modal";
import css from "./UnsavedChangesModal.module.css";

export type UnsavedChangesDecision = "save" | "discard" | "cancel";

export function UnsavedChangesModal({
  documentTitles,
  onChoose
}: {
  documentTitles: string[];
  onChoose: (decision: UnsavedChangesDecision) => void;
}) {
  const label =
    documentTitles.length === 1
      ? `The document "${documentTitles[0]}" has unsaved changes.`
      : `${documentTitles.length} documents have unsaved changes.`;

  return (
    <Modal
      onClose={() => { onChoose("cancel"); }}
      closeOnBackdrop={false}
      size="sm"
      labelledBy="unsaved-changes-title"
      dataTestId="unsaved-changes-modal"
    >
      <Modal.Header
        title="Unsaved Changes"
        titleId="unsaved-changes-title"
      />
      <Modal.Body>
        <p className={css.message} data-select="text">{label}</p>
        {documentTitles.length > 1 ? (
          <ul className={css.list} data-select="text">
            {documentTitles.map((title, index) => (
              <li key={`${title}-${index}`}>{title}</li>
            ))}
          </ul>
        ) : null}
      </Modal.Body>
      <Modal.Footer>
        <Modal.SecondaryButton
          onClick={() => { onChoose("cancel"); }}
          data-testid="unsaved-cancel"
        >
          Cancel
        </Modal.SecondaryButton>
        <Modal.DangerButton
          onClick={() => { onChoose("discard"); }}
          data-testid="unsaved-discard"
        >
          Don&apos;t Save
        </Modal.DangerButton>
        <Modal.PrimaryButton
          onClick={() => { onChoose("save"); }}
          data-testid="unsaved-save"
        >
          Save
        </Modal.PrimaryButton>
      </Modal.Footer>
    </Modal>
  );
}
