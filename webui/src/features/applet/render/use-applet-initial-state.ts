// A single applet-state lifecycle for both local and Jazz-hosted Dim0 boards.
// Shared boards never read or write IndexedDB. Their runtime values live in a
// version-checked Jazz row, separate from the applet's Canvas geometry/source.
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useBoardAppStore } from "@/features/board/harness/store/board-app-store";
import type { JsonValue } from "../tree";
import { fetchAppletState, saveAppletState } from "./state-client";
import {
  JazzAppletStateError, readJazzAppletState, writeJazzAppletState,
} from "./jazz-applet-state-client";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AppletInitialState {
  initialState: Record<string, JsonValue> | undefined;
  /** True after the initial canonical read, not after a failed Jazz request. */
  stateLoaded: boolean;
  /** Incremented only by another writer's Jazz revision (forces renderer hydration). */
  stateRevision: number;
  /** Called from the applet interpreter whenever its persist state changes. */
  persistState: (state: Record<string, unknown>) => void;
  /** A competing writer won; local draft stays visible until explicit refresh. */
  hasConflict: boolean;
  refreshSharedState: () => Promise<void>;
}

/**
 * For Jazz boards, poll only live/selected applets (the canvas has a bounded
 * live mount pool), not every offscreen node. The inspector hydrates separately.
 * IndexedDB remains the default for local and original legacy boards.
 */
export function useAppletInitialState(noteId: string, active = true): AppletInitialState {
  const boardId = useBoardAppStore((s) => s.boardId);
  const canEdit = useBoardAppStore((s) => s.canEdit);
  const jazz = import.meta.env.VITE_DIM0_JAZZ_CANVAS === "1" &&
    !!boardId && UUID.test(boardId) && typeof window !== "undefined" &&
    window.location.pathname.startsWith("/boards/");
  const [initialState, setInitialState] = useState<Record<string, JsonValue> | undefined>();
  const [stateLoaded, setStateLoaded] = useState(false);
  const [stateRevision, setStateRevision] = useState(0);
  const [hasConflict, setHasConflict] = useState(false);
  const versionRef = useRef(0);
  const loadedRef = useRef(false);
  const pendingRef = useRef<Record<string, unknown> | null>(null);
  const savingRef = useRef(false);
  const conflictedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyCanonical = useCallback((
    data: { version: number; value: Record<string, unknown> | null },
    force = false,
  ) => {
    if (!force && (pendingRef.current || savingRef.current || conflictedRef.current)) return;
    const changed = force || !loadedRef.current || data.version !== versionRef.current;
    if (!changed) return;
    if (loadedRef.current) setStateRevision((n) => n + 1);
    versionRef.current = data.version;
    setInitialState(data.value ? data.value as Record<string, JsonValue> : undefined);
    loadedRef.current = true;
    setStateLoaded(true);
  }, []);

  const refreshSharedState = useCallback(async () => {
    if (!jazz || !boardId) return;
    const data = await readJazzAppletState(boardId, noteId);
    pendingRef.current = null;
    conflictedRef.current = false;
    setHasConflict(false);
    applyCanonical(data, true);
  }, [jazz, boardId, noteId, applyCanonical]);

  useEffect(() => {
    let disposed = false;
    loadedRef.current = false;
    versionRef.current = 0;
    conflictedRef.current = false;
    pendingRef.current = null;
    setHasConflict(false);
    setInitialState(undefined);
    setStateLoaded(false);
    setStateRevision(0);
    if (!active) return () => { disposed = true; };
    if (!jazz || !boardId) {
      void fetchAppletState(noteId).then((state) => {
        if (!disposed) {
          if (state && typeof state === "object" && !Array.isArray(state)) {
            setInitialState(state as Record<string, JsonValue>);
          }
          loadedRef.current = true;
          setStateLoaded(true);
        }
      }).catch(() => { if (!disposed) setStateLoaded(true); });
      return () => { disposed = true; };
    }
    const poll = async () => {
      if (pendingRef.current || savingRef.current || conflictedRef.current) return;
      try {
        const data = await readJazzAppletState(boardId, noteId);
        if (!disposed) applyCanonical(data);
      } catch {
        // Do not fall back to independent local state if the Jazz server is down:
        // that could silently fork a shared applet. The next poll retries.
      }
    };
    void poll();
    const interval = window.setInterval(() => { void poll(); }, 1500);
    return () => { disposed = true; clearInterval(interval); };
  }, [noteId, boardId, jazz, active, applyCanonical]);

  const flush = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    if (savingRef.current || conflictedRef.current) return;
    savingRef.current = true;
    try {
      while (pendingRef.current) {
        const next = pendingRef.current;
        pendingRef.current = null;
        try {
          if (jazz && boardId) {
            const result = await writeJazzAppletState(boardId, noteId, versionRef.current, next);
            versionRef.current = result.version;
          } else {
            await saveAppletState(noteId, next);
          }
        } catch (error) {
          if (error instanceof JazzAppletStateError && error.status === 409) {
            // Never automatically overwrite the winning writer's Jazz value.
            conflictedRef.current = true;
            setHasConflict(true);
            pendingRef.current = null;
            toast.error("Another editor changed this applet first. Your local value was not saved.", {
              id: "jazz-applet-conflict-" + noteId,
              duration: Infinity,
              action: {
                label: "Copy local state",
                onClick: () => {
                  void navigator.clipboard.writeText(JSON.stringify(next, null, 2))
                    .then(() => toast.success("Applet draft copied. Refresh its state to continue."))
                    .catch(() => toast.error("Clipboard unavailable; keep this applet open."));
                },
              },
            });
            break;
          }
          // A network error does not delete a user's pending draft.
          pendingRef.current = next;
          toast.error("Shared applet state was not saved. Keep the board open and retry.", {
            id: "jazz-applet-save-error-" + noteId,
          });
          break;
        }
      }
    } finally {
      savingRef.current = false;
    }
  }, [boardId, jazz, noteId]);

  const persistState = useCallback((next: Record<string, unknown>) => {
    if (jazz && !canEdit) return;
    if (conflictedRef.current) return;
    pendingRef.current = next;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { void flush(); }, 300);
  }, [jazz, canEdit, flush]);

  useEffect(() => () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    // Flush a final pending state on unmount, matching the old IndexedDB flow.
    if (pendingRef.current && !conflictedRef.current) void flush();
  }, [flush]);

  return {
    initialState, stateLoaded, stateRevision, persistState,
    hasConflict, refreshSharedState,
  };
}
