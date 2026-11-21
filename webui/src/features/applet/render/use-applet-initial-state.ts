// One applet-state lifecycle for local and Jazz-hosted Dim0 boards.
// Jazz owns shared values; in-flight writes, local drafts and polls are
// coordinated so failed acknowledgements and reordered responses cannot roll
// back a more recent local edit or a committed canonical revision.
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { useBoardAppStore } from "@/features/board/harness/store/board-app-store"
import type { JsonValue } from "../tree"
import { fetchAppletState, saveAppletState } from "./state-client"
import {
  JazzAppletStateError, readJazzAppletState, writeJazzAppletState,
} from "./jazz-applet-state-client"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Draft = Record<string, unknown>
type Canonical = { version: number; value: Draft | null }
export type AppletSaveStatus = "idle" | "saving" | "saved" | "unsaved" | "conflict"

const equalJson = (a: Draft | null, b: Draft | null): boolean =>
  JSON.stringify(a) === JSON.stringify(b)


export interface AppletInitialState {
  initialState: Record<string, JsonValue> | undefined
  /** True after the first valid canonical read. */
  stateLoaded: boolean
  /** Increments only when a canonical value rehydrates the interpreter. */
  stateRevision: number
  persistState: (state: Draft) => void
  hasConflict: boolean
  saveStatus: AppletSaveStatus
  /** Canonical value to show alongside the preserved draft in a conflict. */
  conflictingSharedValue: Draft | null
  copyLocalDraft: () => Promise<void>
  retrySave: () => Promise<void>
  refreshSharedState: () => Promise<void>
}


/**
 * Poll only visible applets. Reads never downgrade a revision or a pending
 * draft; Retry re-reads Jazz before deciding whether to write again.
 */
export function useAppletInitialState(noteId: string, active = true): AppletInitialState {
  const boardId = useBoardAppStore((s) => s.boardId)
  const canEdit = useBoardAppStore((s) => s.canEdit)
  const jazz = import.meta.env.VITE_DIM0_JAZZ_CANVAS === "1" &&
    !!boardId && UUID.test(boardId) && typeof window !== "undefined" &&
    window.location.pathname.startsWith("/boards/")

  const [initialState, setInitialState] = useState<Record<string, JsonValue> | undefined>()
  const [stateLoaded, setStateLoaded] = useState(false)
  const [stateRevision, setStateRevision] = useState(0)
  const [hasConflict, setHasConflict] = useState(false)
  const [saveStatus, setSaveStatus] = useState<AppletSaveStatus>("idle")
  const [conflictingSharedValue, setConflictingSharedValue] = useState<Draft | null>(null)

  const versionRef = useRef(0)
  const loadedRef = useRef(false)
  const pendingRef = useRef<Draft | null>(null)
  const attemptedRef = useRef<Draft | null>(null)
  const latestDraftRef = useRef<Draft | null>(null)
  const savingRef = useRef(false)
  const retryingRef = useRef(false)
  const failedRef = useRef(false)
  const conflictedRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeGeneration = useRef(0)

  /** Reject stale responses, even after an explicit manual refresh. */
  const applyCanonical = useCallback((
    data: Canonical, generation: number, manual = false,
  ): boolean => {
    if (generation !== activeGeneration.current) return false
    if (loadedRef.current && (data.version < versionRef.current ||
      (!manual && data.version <= versionRef.current))) return false
    if (!manual && (pendingRef.current || savingRef.current ||
      failedRef.current || retryingRef.current || conflictedRef.current)) return false

    if (loadedRef.current) setStateRevision((n) => n + 1)
    versionRef.current = data.version
    setInitialState(data.value ? data.value as Record<string, JsonValue> : undefined)
    loadedRef.current = true
    setStateLoaded(true)
    return true
  }, [])

  /** Preserve the latest attempted value for a conflict copy, not an old POST. */
  const copyLocalDraft = useCallback(async () => {
    const draft = latestDraftRef.current ?? pendingRef.current ?? attemptedRef.current
    if (!draft) return
    try {
      await navigator.clipboard.writeText(JSON.stringify(draft, null, 2))
      toast.success("Applet draft copied. Compare it with the shared state before replacing anything.")
    } catch {
      toast.error("Clipboard unavailable; keep this applet open.")
    }
  }, [])

  const markConflict = useCallback((shared: Draft | null) => {
    conflictedRef.current = true
    failedRef.current = false
    setHasConflict(true)
    setConflictingSharedValue(shared)
    setSaveStatus("conflict")
    toast.error("Another editor changed this applet. Your latest draft is retained.", {
      id: "jazz-applet-conflict-" + noteId,
      duration: Infinity,
      action: { label: "Copy draft", onClick: () => { void copyLocalDraft() } },
    })
  }, [copyLocalDraft, noteId])

  /** Save the latest pending draft after the previous write resolves. */
  const flush = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    if (savingRef.current || failedRef.current || conflictedRef.current) return
    if (!pendingRef.current) return

    const generation = activeGeneration.current
    savingRef.current = true
    if (jazz) setSaveStatus("saving")
    try {
      while (pendingRef.current && generation === activeGeneration.current) {
        const next = pendingRef.current
        pendingRef.current = null
        attemptedRef.current = next
        try {
          if (jazz && boardId) {
            const result = await writeJazzAppletState(boardId, noteId, versionRef.current, next)
            if (generation !== activeGeneration.current) return
            if (result.version > versionRef.current) versionRef.current = result.version
          } else {
            await saveAppletState(noteId, next)
            if (generation !== activeGeneration.current) return
          }
          attemptedRef.current = null
        } catch (error) {
          if (generation !== activeGeneration.current) return
          // Never let a failing older in-flight POST replace a newer click.
          pendingRef.current ??= next
          if (error instanceof JazzAppletStateError && error.status === 409) {
            // Show the winning shared value without discarding the local draft.
            const remote = jazz && boardId
              ? await readJazzAppletState(boardId, noteId).catch(() => null)
              : null
            if (generation !== activeGeneration.current) return
            markConflict(remote?.value ?? null)
          } else {
            failedRef.current = true
            setSaveStatus("unsaved")
            toast.error("Shared applet state is unsaved. Select Retry to check Jazz and save.", {
              id: "jazz-applet-save-error-" + noteId,
            })
          }
          return
        }
      }
      if (jazz && generation === activeGeneration.current) setSaveStatus("saved")
    } finally {
      if (generation === activeGeneration.current) savingRef.current = false
    }
  }, [boardId, jazz, noteId, markConflict])

  /**
   * An ambiguous failure can mean the server committed but the acknowledgement
   * was lost. Read Jazz first, recognize that attempted value, then save only a
   * newer local draft against the acknowledged version.
   */
  const retrySave = useCallback(async () => {
    if (!jazz || !boardId || savingRef.current || retryingRef.current ||
      conflictedRef.current || !failedRef.current) return

    const generation = activeGeneration.current
    retryingRef.current = true
    setSaveStatus("saving")
    try {
      const current = await readJazzAppletState(boardId, noteId)
      if (generation !== activeGeneration.current) return
      if (loadedRef.current && current.version < versionRef.current) {
        failedRef.current = true
        setSaveStatus("unsaved")
        return
      }

      const attempted = attemptedRef.current
      const newest = pendingRef.current ?? attempted
      if (current.version > versionRef.current) {
        if (equalJson(current.value, attempted) || equalJson(current.value, newest)) {
          // The previous POST (or latest desired value) already landed.
          versionRef.current = current.version
          attemptedRef.current = null
          pendingRef.current = newest && !equalJson(current.value, newest) ? newest : null
          if (!pendingRef.current) {
            failedRef.current = false
            setSaveStatus("saved")
            return
          }
        } else {
          // Another writer won. Preserve the draft and show their value.
          markConflict(current.value)
          return
        }
      } else if (!pendingRef.current && attempted) {
        pendingRef.current = attempted
      }

      failedRef.current = false
      await flush()
    } catch {
      if (generation !== activeGeneration.current) return
      failedRef.current = true
      setSaveStatus("unsaved")
      toast.error("Unable to verify shared state; the latest local draft is still available.", {
        id: "jazz-applet-save-error-" + noteId,
      })
    } finally {
      if (generation === activeGeneration.current) retryingRef.current = false
    }
  }, [jazz, boardId, noteId, flush, markConflict])

  /** Manual refresh discards a draft only after a successful, non-stale read. */
  const refreshSharedState = useCallback(async () => {
    if (!jazz || !boardId || savingRef.current || retryingRef.current) return
    const generation = activeGeneration.current
    try {
      const data = await readJazzAppletState(boardId, noteId)
      if (generation !== activeGeneration.current ||
        (loadedRef.current && data.version < versionRef.current)) return
      pendingRef.current = null
      attemptedRef.current = null
      latestDraftRef.current = null
      failedRef.current = false
      conflictedRef.current = false
      setHasConflict(false)
      setConflictingSharedValue(null)
      setSaveStatus("idle")
      applyCanonical(data, generation, true)
    } catch {
      if (generation === activeGeneration.current) {
        toast.error("Unable to reload the shared state; your local draft is still available.")
      }
    }
  }, [jazz, boardId, noteId, applyCanonical])

  useEffect(() => {
    const generation = ++activeGeneration.current
    let disposed = false
    loadedRef.current = false
    versionRef.current = 0
    savingRef.current = false
    retryingRef.current = false
    failedRef.current = false
    conflictedRef.current = false
    pendingRef.current = null
    attemptedRef.current = null
    latestDraftRef.current = null
    setHasConflict(false)
    setConflictingSharedValue(null)
    setSaveStatus("idle")
    setInitialState(undefined)
    setStateLoaded(false)
    setStateRevision(0)

    if (!active) return () => { disposed = true; activeGeneration.current = generation + 1 }
    if (!jazz || !boardId) {
      void fetchAppletState(noteId).then((state) => {
        if (!disposed && generation === activeGeneration.current) {
          if (state && typeof state === "object" && !Array.isArray(state)) {
            setInitialState(state as Record<string, JsonValue>)
          }
          loadedRef.current = true
          setStateLoaded(true)
        }
      }).catch(() => {
        if (!disposed && generation === activeGeneration.current) setStateLoaded(true)
      })
      return () => { disposed = true; activeGeneration.current = generation + 1 }
    }

    const poll = async () => {
      if (pendingRef.current || savingRef.current || failedRef.current ||
        conflictedRef.current || retryingRef.current) return
      try {
        const data = await readJazzAppletState(boardId, noteId)
        if (!disposed && generation === activeGeneration.current) {
          applyCanonical(data, generation)
        }
      } catch {
        // Never fork a shared applet into local state when Jazz is offline.
      }
    }
    void poll()
    const interval = window.setInterval(() => { void poll() }, 1500)
    return () => {
      disposed = true
      activeGeneration.current = generation + 1
      clearInterval(interval)
    }
  }, [noteId, boardId, jazz, active, applyCanonical])

  const persistState = useCallback((next: Draft) => {
    if (jazz && !canEdit) return
    if (conflictedRef.current) return
    latestDraftRef.current = next
    pendingRef.current = next
    if (jazz) setSaveStatus(failedRef.current ? "unsaved" : "saving")
    if (timerRef.current) clearTimeout(timerRef.current)
    if (failedRef.current || retryingRef.current) return
    timerRef.current = setTimeout(() => { void flush() }, 300)
  }, [jazz, canEdit, flush])

  useEffect(() => () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    // Legacy/local boards flush on close. Jazz boards never allow an
    // unverified background retry to overwrite a concurrent remote edit.
    if (!jazz && pendingRef.current && !conflictedRef.current) void flush()
  }, [flush, jazz])

  return {
    initialState, stateLoaded, stateRevision, persistState, hasConflict,
    saveStatus, conflictingSharedValue, copyLocalDraft, retrySave, refreshSharedState,
  }
}
