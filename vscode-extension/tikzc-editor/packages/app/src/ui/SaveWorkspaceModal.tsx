import { useMemo, useState } from "react";
import { Modal } from "./Modal";
import { getDockLayoutHandle } from "./DockLayout";
import { useWorkspaceListStore } from "../store/workspace-list-store";
import { isReservedWorkspaceName } from "./workspace-apply";
import css from "./SaveWorkspaceModal.module.css";

type SaveWorkspaceModalProps = {
  onClose: () => void;
};

export function SaveWorkspaceModal({ onClose }: SaveWorkspaceModalProps) {
  const [name, setName] = useState("");
  const [pendingOverwriteId, setPendingOverwriteId] = useState<string | null>(null);
  const userWorkspaces = useWorkspaceListStore((s) => s.userWorkspaces);
  const createWorkspace = useWorkspaceListStore((s) => s.createWorkspace);
  const overwriteWorkspace = useWorkspaceListStore((s) => s.overwriteWorkspace);

  const trimmed = name.trim();
  const reserved = trimmed.length > 0 && isReservedWorkspaceName(trimmed);
  const existingMatch = useMemo(
    () => userWorkspaces.find((ws) => ws.name.toLowerCase() === trimmed.toLowerCase()) ?? null,
    [userWorkspaces, trimmed]
  );

  const canSubmit = trimmed.length > 0 && !reserved;

  function onSubmit(event: React.FormEvent): void {
    event.preventDefault();
    if (!canSubmit) return;

    const handle = getDockLayoutHandle();
    if (!handle) {
      onClose();
      return;
    }
    const json = handle.getCurrentJson();

    if (existingMatch) {
      setPendingOverwriteId(existingMatch.id);
      return;
    }

    createWorkspace(trimmed, json);
    onClose();
  }

  function confirmOverwrite(): void {
    if (!pendingOverwriteId) return;
    const handle = getDockLayoutHandle();
    if (!handle) {
      onClose();
      return;
    }
    overwriteWorkspace(pendingOverwriteId, handle.getCurrentJson());
    onClose();
  }

  if (pendingOverwriteId) {
    return (
      <Modal
        onClose={onClose}
        size="sm"
        labelledBy="save-workspace-modal-title"
        dataTestId="save-workspace-overwrite-modal"
      >
        <Modal.Header
          title="Overwrite workspace?"
          titleId="save-workspace-modal-title"
          showCloseButton
          onClose={onClose}
          closeAriaLabel="Close save workspace dialog"
        />
        <Modal.Body>
          <p className={css.message}>
            A workspace named &ldquo;{trimmed}&rdquo; already exists. Overwrite it with the current layout?
          </p>
        </Modal.Body>
        <Modal.Footer>
          <Modal.SecondaryButton onClick={() => { setPendingOverwriteId(null); }}>
            Back
          </Modal.SecondaryButton>
          <Modal.PrimaryButton
            onClick={confirmOverwrite}
            data-testid="save-workspace-overwrite-confirm"
          >
            Overwrite
          </Modal.PrimaryButton>
        </Modal.Footer>
      </Modal>
    );
  }

  return (
    <Modal
      onClose={onClose}
      size="sm"
      labelledBy="save-workspace-modal-title"
      dataTestId="save-workspace-modal"
    >
      <form onSubmit={onSubmit} className={css.form}>
        <Modal.Header
          title="Save Workspace As…"
          titleId="save-workspace-modal-title"
          showCloseButton
          onClose={onClose}
          closeAriaLabel="Close save workspace dialog"
        />
        <Modal.Body>
          <label className={css.field}>
            <span className={css.fieldLabel}>Name</span>
            <input
              data-testid="save-workspace-name-input"
              autoFocus
              type="text"
              className={css.input}
              value={name}
              placeholder="My workspace"
              onChange={(event) => { setName(event.target.value); }}
            />
          </label>
          {reserved ? (
            <p className={css.warning}>This name is reserved for a built-in workspace.</p>
          ) : existingMatch ? (
            <p className={css.hint}>Saving will prompt to overwrite &ldquo;{existingMatch.name}&rdquo;.</p>
          ) : null}
        </Modal.Body>
        <Modal.Footer>
          <Modal.SecondaryButton onClick={onClose}>Cancel</Modal.SecondaryButton>
          <Modal.PrimaryButton
            type="submit"
            disabled={!canSubmit}
            data-testid="save-workspace-confirm"
          >
            Save
          </Modal.PrimaryButton>
        </Modal.Footer>
      </form>
    </Modal>
  );
}
