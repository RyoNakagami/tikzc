import { create } from "zustand";
import type { IJsonModel } from "flexlayout-react";
import {
  loadUserWorkspaces,
  saveUserWorkspaces,
  type UserWorkspace,
} from "./workspace-storage";

type WorkspaceListState = {
  userWorkspaces: UserWorkspace[];
  createWorkspace: (name: string, json: IJsonModel) => UserWorkspace;
  overwriteWorkspace: (id: string, json: IJsonModel) => void;
  renameWorkspace: (id: string, newName: string) => void;
  deleteWorkspace: (id: string) => void;
  reorderWorkspaces: (orderedIds: string[]) => void;
};

function newId(): string {
  return `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useWorkspaceListStore = create<WorkspaceListState>((set) => ({
  userWorkspaces: loadUserWorkspaces(),
  createWorkspace: (name, json) => {
    const entry: UserWorkspace = { id: newId(), name, json, createdAt: Date.now() };
    set((state) => {
      const next = [...state.userWorkspaces, entry];
      saveUserWorkspaces(next);
      return { userWorkspaces: next };
    });
    return entry;
  },
  overwriteWorkspace: (id, json) => {
    set((state) => {
      const next = state.userWorkspaces.map((ws) => (ws.id === id ? { ...ws, json } : ws));
      saveUserWorkspaces(next);
      return { userWorkspaces: next };
    });
  },
  renameWorkspace: (id, newName) => {
    const trimmed = newName.trim();
    if (trimmed.length === 0) return;
    set((state) => {
      const next = state.userWorkspaces.map((ws) => (ws.id === id ? { ...ws, name: trimmed } : ws));
      saveUserWorkspaces(next);
      return { userWorkspaces: next };
    });
  },
  deleteWorkspace: (id) => {
    set((state) => {
      const next = state.userWorkspaces.filter((ws) => ws.id !== id);
      saveUserWorkspaces(next);
      return { userWorkspaces: next };
    });
  },
  reorderWorkspaces: (orderedIds) => {
    set((state) => {
      const byId = new Map(state.userWorkspaces.map((ws) => [ws.id, ws]));
      const reordered = orderedIds
        .map((id) => byId.get(id))
        .filter((ws): ws is UserWorkspace => ws != null);
      // Preserve any items not referenced in orderedIds (defensive)
      for (const ws of state.userWorkspaces) {
        if (!orderedIds.includes(ws.id)) reordered.push(ws);
      }
      saveUserWorkspaces(reordered);
      return { userWorkspaces: reordered };
    });
  },
}));
