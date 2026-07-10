import { useRef, useState } from "react";
import { Modal } from "./Modal";
import { useWorkspaceListStore } from "../store/workspace-list-store";
import { isReservedWorkspaceName } from "./workspace-apply";
import css from "./ManageWorkspacesModal.module.css";

type ManageWorkspacesModalProps = {
  onClose: () => void;
};

export function ManageWorkspacesModal({ onClose }: ManageWorkspacesModalProps) {
  const userWorkspaces = useWorkspaceListStore((s) => s.userWorkspaces);
  const renameWorkspace = useWorkspaceListStore((s) => s.renameWorkspace);
  const deleteWorkspace = useWorkspaceListStore((s) => s.deleteWorkspace);
  const reorderWorkspaces = useWorkspaceListStore((s) => s.reorderWorkspaces);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const dragIndexRef = useRef<number | null>(null);

  function startRename(id: string, currentName: string): void {
    setEditingId(id);
    setEditingName(currentName);
    setRenameError(null);
  }

  function commitRename(): void {
    if (!editingId) return;
    const trimmed = editingName.trim();
    if (trimmed.length === 0) {
      cancelRename();
      return;
    }
    if (isReservedWorkspaceName(trimmed)) {
      setRenameError("Name is reserved for a built-in workspace.");
      return;
    }
    const collision = userWorkspaces.find(
      (ws) => ws.id !== editingId && ws.name.toLowerCase() === trimmed.toLowerCase()
    );
    if (collision) {
      setRenameError("Another workspace already has this name.");
      return;
    }
    renameWorkspace(editingId, trimmed);
    cancelRename();
  }

  function cancelRename(): void {
    setEditingId(null);
    setEditingName("");
    setRenameError(null);
  }

  function onDelete(id: string, name: string): void {
    const confirmFn = (globalThis as { confirm?: (message?: string) => boolean }).confirm;
    const ok = typeof confirmFn === "function"
      ? confirmFn(`Delete workspace “${name}”?`)
      : true;
    if (!ok) return;
    deleteWorkspace(id);
    if (editingId === id) cancelRename();
  }

  function onDragStart(index: number): void {
    dragIndexRef.current = index;
  }

  function onDragOver(event: React.DragEvent): void {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function onDrop(targetIndex: number): void {
    const fromIndex = dragIndexRef.current;
    dragIndexRef.current = null;
    if (fromIndex == null || fromIndex === targetIndex) return;
    const nextOrder = [...userWorkspaces];
    const [moved] = nextOrder.splice(fromIndex, 1);
    if (!moved) return;
    nextOrder.splice(targetIndex, 0, moved);
    reorderWorkspaces(nextOrder.map((ws) => ws.id));
  }

  return (
    <Modal
      onClose={onClose}
      size="sm"
      labelledBy="manage-workspaces-modal-title"
      dataTestId="manage-workspaces-modal"
    >
      <Modal.Header
        title="Manage Workspaces"
        titleId="manage-workspaces-modal-title"
        showCloseButton
        onClose={onClose}
        closeAriaLabel="Close manage workspaces dialog"
      />
      <Modal.Body>
        {userWorkspaces.length === 0 ? (
          <p className={css.empty}>
            No custom workspaces yet. Use <em>View → Save Workspace As…</em> to save the current layout.
          </p>
        ) : (
          <ul className={css.list}>
            {userWorkspaces.map((ws, index) => {
              const isEditing = editingId === ws.id;
              return (
                <li
                  key={ws.id}
                  className={css.item}
                  draggable={!isEditing}
                  onDragStart={() => { onDragStart(index); }}
                  onDragOver={onDragOver}
                  onDrop={() => { onDrop(index); }}
                  data-testid={`manage-workspaces-item-${ws.id}`}
                >
                  <span className={css.dragHandle} aria-hidden="true">⋮⋮</span>
                  {isEditing ? (
                    <input
                      className={css.renameInput}
                      autoFocus
                      value={editingName}
                      onChange={(event) => {
                        setEditingName(event.target.value);
                        setRenameError(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          commitRename();
                        } else if (event.key === "Escape") {
                          event.preventDefault();
                          cancelRename();
                        }
                      }}
                      onBlur={commitRename}
                      data-testid={`manage-workspaces-rename-input-${ws.id}`}
                    />
                  ) : (
                    <span className={css.name}>{ws.name}</span>
                  )}
                  <div className={css.itemActions}>
                    {isEditing ? null : (
                      <button
                        type="button"
                        className={css.itemActionButton}
                        onClick={() => { startRename(ws.id, ws.name); }}
                        data-testid={`manage-workspaces-rename-${ws.id}`}
                      >
                        Rename
                      </button>
                    )}
                    <button
                      type="button"
                      className={`${css.itemActionButton} ${css.itemActionDanger}`}
                      onClick={() => { onDelete(ws.id, ws.name); }}
                      data-testid={`manage-workspaces-delete-${ws.id}`}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {renameError ? <p className={css.warning}>{renameError}</p> : null}
      </Modal.Body>
    </Modal>
  );
}
