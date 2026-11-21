import { useEffect, useRef } from "react"
import type { CanvasStore } from "@canvas-harness/core"
import type { BoardRole } from "@/features/board/api/get-board"
import type { Graph } from "@/features/board/types/board"
import { nodeToNote } from "../harness/convert/node-to-note"
import { edgeToLink } from "../harness/convert/edge-to-link"
import { applyGraphToStore } from "../harness/persist/snapshot-load"
import {
  JazzCanvasApiError,
  createJazzCanvasEntity,
  deleteJazzCanvasEntity,
  loadJazzCanvas,
  splitJazzCanvasEntities,
  subscribeJazzCanvas,
  updateJazzCanvasEntity,
  type JazzCanvasRecord,
  type JazzCanvasSnapshot,
} from "./jazz-canvas-api"


type SyncCallbacks = {
  onRole: (role: BoardRole) => void
  onReady: () => void
  onError: (message: string) => void
}


/** Experimentally bind the Dim0 canvas to Jazz's authorized, live-backed data.
 * Local edits are CAS-serialized, so conflicting writes fail closed rather than
 * replacing another editor's content. This is NOT yet an offline outbox.
 */
export function useJazzCanvasSync(
  store: CanvasStore,
  boardId: string | null,
  enabled: boolean,
  rootId: string | null,
  callbacks: SyncCallbacks,
): void {
  const callbacksRef = useRef(callbacks)
  callbacksRef.current = callbacks

  useEffect(() => {
    if (!enabled || !boardId) return

    let disposed = false
    let hydrated = false
    let blocked = false
    let busy = false
    let debounce: ReturnType<typeof setTimeout> | null = null
    let lastSnapshot: JazzCanvasSnapshot | null = null
    const dirty = new Set<string>()
    const versions = new Map<string, JazzCanvasRecord>()

    callbacksRef.current.onRole(null)

    /** Paint a full Jazz snapshot as remote operations to avoid write echoes. */
    const applySnapshot = (snapshot: JazzCanvasSnapshot): void => {
      if (disposed || busy || dirty.size > 0 || blocked) return
      const { notes, links } = splitJazzCanvasEntities(snapshot)
      const inLayer = (item: Record<string, unknown>) =>
        (item.parentId ?? null) === rootId
      const scopedNotes = notes.filter(inLayer)
      const scopedLinks = links.filter(inLayer)
      const graph: Graph = {
        uid: boardId,
        type: "graph",
        nodes: scopedNotes as unknown as NonNullable<Graph["nodes"]>,
        edges: scopedLinks as unknown as NonNullable<Graph["edges"]>,
        readonly: snapshot.role === "viewer",
        visibility: "private",
        createdAt: new Date(0).toISOString(),
      }
      // Merge handles deletions from a nonempty snapshot, but the Dim0 merge
      // intentionally treats an EMPTY graph as a transient server failure.
      // A verified complete Jazz stream snapshot is different: empty means
      // all entities were deleted and must clear the board.
      const mode = !hydrated || (scopedNotes.length === 0 && scopedLinks.length === 0)
        ? "replace"
        : "merge"
      applyGraphToStore(store, graph, { mode })
      versions.clear()
      for (const record of snapshot.entities) versions.set(record.id, record)
      callbacksRef.current.onRole(snapshot.role ?? "viewer")
      if (!hydrated) {
        hydrated = true
        callbacksRef.current.onReady()
      }
    }

    /** Persist only the latest state of each locally changed entity. */
    const flush = async (): Promise<void> => {
      if (disposed || !hydrated || busy || blocked || dirty.size === 0) return
      busy = true
      try {
        while (dirty.size > 0 && !disposed && !blocked) {
          const ids = [...dirty]
          dirty.clear()
          const nodeById = new Map(store.getAllNodes().map((node) => [String(node.id), node]))
          const edgeById = new Map(store.getAllEdges().map((edge) => [String(edge.id), edge]))
          // Create nodes before links. Delete links before their endpoint nodes.
          const priority = (id: string): number => {
            if (nodeById.has(id)) return 0
            if (edgeById.has(id)) return 1
            if (versions.get(id)?.kind === "link") return 2
            return 3
          }
          ids.sort((a, b) => priority(a) - priority(b))
          for (const id of ids) {
            if (disposed) return
            const current = versions.get(id)
            const node = nodeById.get(id)
            const edge = edgeById.get(id)
            try {
              if (node || edge) {
                const kind = node ? "node" : "link"
                const payload = node ? nodeToNote(node) : edgeToLink(edge!, nodeById)
                const result = current
                  ? await updateJazzCanvasEntity(boardId, id, current.version, payload as unknown as Record<string, unknown>)
                  : await createJazzCanvasEntity(boardId, kind, payload as unknown as Record<string, unknown>)
                versions.set(id, result)
              } else if (current) {
                await deleteJazzCanvasEntity(boardId, id, current.version)
                versions.delete(id)
              }
            } catch (error) {
              dirty.add(id)
              blocked = true
              // No blind version retry: a 409 means an external agent or human
              // edited the same entity. Keep the local scene intact for review.
              const detail = error instanceof JazzCanvasApiError
                ? `Jazz ${error.operation} HTTP ${error.status}`
                : "Jazz write failed"
              callbacksRef.current.onRole("viewer")
              callbacksRef.current.onError(
                `${detail}. Editing suspended; local unsaved changes were not discarded.`,
              )
              break
            }
          }
        }
      } finally {
        busy = false
        if (!disposed && !blocked && dirty.size === 0) {
          // Read-after-write avoids regressing on an SSE snapshot captured
          // before this client finished its serial transaction(s).
          try {
            lastSnapshot = await loadJazzCanvas(boardId)
            applySnapshot(lastSnapshot)
          } catch (error) {
            callbacksRef.current.onError(
              `Jazz refresh failed: ${error instanceof Error ? error.message : "unknown error"}`,
            )
          }
        }
      }
    }

    const onLocalChange = store.subscribe("change", (batch) => {
      // Undo/redo and durable subtree operations use "history" origin.
      // Only remote hydration is excluded from persistence.
      if (!hydrated || blocked || batch.origin === "remote") return
      for (const op of batch.ops) {
        if (op.type === "node.add" || op.type === "node.remove") {
          dirty.add(String(op.node.id))
          if (op.type === "node.remove") {
            // CanvasStore may cascade incident edges without a separate edge
            // removal op; record their deletion explicitly in Jazz.
            for (const entry of versions.values()) {
              if (entry.kind === "link" &&
                (entry.payload.source === String(op.node.id) ||
                  entry.payload.target === String(op.node.id))) dirty.add(entry.id)
            }
          }
        } else if (op.type === "edge.add" || op.type === "edge.remove") {
          dirty.add(String(op.edge.id))
        } else if (op.type === "node.update" || op.type === "edge.update") {
          dirty.add(String(op.id))
        }
      }
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(() => { void flush() }, 100)
    })

    // Jazz Db.subscribe drives this authenticated SSE stream. Stream initial
    // events are full snapshots; on reconnection the same projection converges.
    const unsubscribe = subscribeJazzCanvas(boardId, (snapshot) => {
      if (disposed) return
      lastSnapshot = snapshot
      applySnapshot(snapshot)
    }, (error) => {
      if (!disposed) callbacksRef.current.onError(error.message)
    })

    return () => {
      disposed = true
      if (debounce) clearTimeout(debounce)
      unsubscribe()
      onLocalChange()
    }
  }, [store, boardId, enabled, rootId])
}
