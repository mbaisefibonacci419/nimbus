/**
 * Undo Store — manages snapshots of the tax return state before AI actions are applied.
 *
 * When the user applies actions from the AI assistant, the full TaxReturn is deep-cloned
 * and stored keyed by messageId. If the user clicks "Undo", the snapshot is restored
 * and the message reverts to its unapplied state.
 *
 * Snapshots are session-only (not persisted) and capped at MAX_SNAPSHOTS to prevent
 * unbounded memory growth.
 */

import { create } from 'zustand';
import type { TaxReturn } from '@nimbus/engine';

const MAX_SNAPSHOTS = 20;

interface UndoEntry {
  messageId: string;
  snapshot: TaxReturn;
  timestamp: number;
}

interface UndoState {
  entries: UndoEntry[];
  saveSnapshot: (messageId: string, snapshot: TaxReturn) => void;
  getSnapshot: (messageId: string) => TaxReturn | null;
  removeSnapshot: (messageId: string) => void;
  hasSnapshot: (messageId: string) => boolean;
}

export const useUndoStore = create<UndoState>((set, get) => ({
  entries: [],

  saveSnapshot: (messageId, snapshot) => {
    const clone = JSON.parse(JSON.stringify(snapshot)) as TaxReturn;
    set((state) => {
      const filtered = state.entries.filter((e) => e.messageId !== messageId);
      const updated = [...filtered, { messageId, snapshot: clone, timestamp: Date.now() }];
      if (updated.length > MAX_SNAPSHOTS) {
        updated.splice(0, updated.length - MAX_SNAPSHOTS);
      }
      return { entries: updated };
    });
  },

  getSnapshot: (messageId) => {
    return get().entries.find((e) => e.messageId === messageId)?.snapshot ?? null;
  },

  removeSnapshot: (messageId) => {
    set((state) => ({
      entries: state.entries.filter((e) => e.messageId !== messageId),
    }));
  },

  hasSnapshot: (messageId) => {
    return get().entries.some((e) => e.messageId === messageId);
  },
}));
