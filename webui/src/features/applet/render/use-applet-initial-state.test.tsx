import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useAppletInitialState } from "./use-applet-initial-state"
import { JazzAppletStateError } from "./jazz-applet-state-client"

const { board, read, write, clipboard, toastError, toastSuccess } = vi.hoisted(() => ({
  board: { boardId: "01a1fdec-1b8f-7e30-af11-3a09df695fc5", canEdit: true },
  read: vi.fn(),
  write: vi.fn(),
  clipboard: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}))

vi.mock("@/features/board/harness/store/board-app-store", () => ({
  useBoardAppStore: (select: (state: typeof board) => unknown) => select(board),
}))
vi.mock("./state-client", () => ({ fetchAppletState: vi.fn(), saveAppletState: vi.fn() }))
vi.mock("./jazz-applet-state-client", () => ({
  JazzAppletStateError: class JazzAppletStateError extends Error {
    readonly status: number
    constructor(status: number) { super("HTTP " + status); this.status = status }
  },
  readJazzAppletState: read,
  writeJazzAppletState: write,
}))
vi.mock("sonner", () => ({
  toast: { error: toastError, success: toastSuccess },
}))

const boardId = "01a1fdec-1b8f-7e30-af11-3a09df695fc5"
const noteA = "52f135b4-5cdc-412a-bbd7-bd4294dcf257"
const noteB = "3a32b476-2105-4241-a731-0200b2658d9a"
type Remote = { version: number; value: { count: number } | null }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((ok, bad) => { resolve = ok; reject = bad })
  return { promise, resolve, reject }
}
const error503 = () => Object.assign(new Error("503"), { status: 503 })

let server: Remote


async function advance(ms = 0) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}


beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("VITE_DIM0_JAZZ_CANVAS", "1")
  window.history.replaceState(null, "", "/boards/" + boardId)
  board.boardId = boardId
  board.canEdit = true
  server = { version: 2, value: { count: 2 } }
  read.mockReset().mockImplementation(async () => ({ ...server }))
  write.mockReset().mockImplementation(async (
    _boardId: string, _noteId: string, expectedVersion: number, value: { count: number },
  ) => {
    expect(expectedVersion).toBe(server.version)
    server = { version: server.version + 1, value }
    return { ...server }
  })
  clipboard.mockReset().mockResolvedValue(undefined)
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true, value: { writeText: clipboard },
  })
  toastError.mockReset()
  toastSuccess.mockReset()
})


afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})


async function mounted(noteId = noteA) {
  const hook = renderHook(({ id }) => useAppletInitialState(id), {
    initialProps: { id: noteId },
  })
  await advance()
  expect(hook.result.current.stateLoaded).toBe(true)
  return hook
}


describe("shared Jazz applet reliability", () => {
  it("recovers a 503 before commit using the latest version and shows Unsaved until ack", async () => {
    const hook = await mounted()
    expect(hook.result.current.initialState).toEqual({ count: 2 })
    write.mockRejectedValueOnce(error503())

    act(() => hook.result.current.persistState({ count: 3 }))
    await advance(305)
    expect(hook.result.current.saveStatus).toBe("unsaved")
    expect(write).toHaveBeenCalledWith(boardId, noteA, 2, { count: 3 })
    expect(server.version).toBe(2)

    await act(async () => { await hook.result.current.retrySave() })
    expect(read).toHaveBeenCalledTimes(2)
    expect(write).toHaveBeenCalledTimes(2)
    expect(write).toHaveBeenLastCalledWith(boardId, noteA, 2, { count: 3 })
    expect(server).toEqual({ version: 3, value: { count: 3 } })
    expect(hook.result.current.saveStatus).toBe("saved")
  })

  it("accepts a lost ack after the server commits, avoiding a duplicate POST", async () => {
    const hook = await mounted()
    write.mockImplementationOnce(async () => {
      server = { version: 3, value: { count: 3 } }
      throw error503()
    })

    act(() => hook.result.current.persistState({ count: 3 }))
    await advance(305)
    expect(hook.result.current.saveStatus).toBe("unsaved")
    await act(async () => { await hook.result.current.retrySave() })
    expect(write).toHaveBeenCalledTimes(1)
    expect(hook.result.current.saveStatus).toBe("saved")

    act(() => hook.result.current.persistState({ count: 4 }))
    await advance(305)
    expect(write).toHaveBeenLastCalledWith(boardId, noteA, 3, { count: 4 })
    expect(server).toEqual({ version: 4, value: { count: 4 } })
  })

  it("preserves the second click while the first POST is in flight and fails", async () => {
    const hook = await mounted()
    const first = deferred<Remote>()
    write.mockImplementationOnce(() => first.promise)

    act(() => hook.result.current.persistState({ count: 3 }))
    await advance(305)
    expect(write).toHaveBeenCalledTimes(1)

    act(() => hook.result.current.persistState({ count: 4 }))
    await act(async () => { first.reject(error503()) })
    expect(hook.result.current.saveStatus).toBe("unsaved")
    await advance(400)
    expect(write).toHaveBeenCalledTimes(1)

    await act(async () => { await hook.result.current.retrySave() })
    expect(write).toHaveBeenCalledTimes(2)
    expect(write).toHaveBeenLastCalledWith(boardId, noteA, 2, { count: 4 })
    expect(hook.result.current.saveStatus).toBe("saved")
    expect(server).toEqual({ version: 3, value: { count: 4 } })
  })

  it("saves a newer draft after recognizing that the previous POST committed", async () => {
    const hook = await mounted()
    const first = deferred<Remote>()
    write.mockImplementationOnce(() => first.promise)

    act(() => hook.result.current.persistState({ count: 3 }))
    await advance(305)
    act(() => hook.result.current.persistState({ count: 4 }))
    server = { version: 3, value: { count: 3 } }
    await act(async () => { first.reject(error503()) })
    expect(hook.result.current.saveStatus).toBe("unsaved")

    await act(async () => { await hook.result.current.retrySave() })
    expect(write).toHaveBeenLastCalledWith(boardId, noteA, 3, { count: 4 })
    expect(server).toEqual({ version: 4, value: { count: 4 } })
    expect(hook.result.current.saveStatus).toBe("saved")
  })

  it("conflicts with a peer's newer different value; retains draft for copy and refresh", async () => {
    const hook = await mounted()
    write.mockRejectedValueOnce(error503())
    act(() => hook.result.current.persistState({ count: 3 }))
    await advance(305)
    server = { version: 3, value: { count: 17 } }

    await act(async () => { await hook.result.current.retrySave() })
    expect(hook.result.current.saveStatus).toBe("conflict")
    expect(hook.result.current.conflictingSharedValue).toEqual({ count: 17 })
    expect(write).toHaveBeenCalledTimes(1)
    await act(async () => { await hook.result.current.copyLocalDraft() })
    expect(clipboard).toHaveBeenCalledWith(JSON.stringify({ count: 3 }, null, 2))

    // An older manual refresh must not silently clear a conflict.
    read.mockResolvedValueOnce({ version: 1, value: { count: 1 } })
    await act(async () => { await hook.result.current.refreshSharedState() })
    expect(hook.result.current.saveStatus).toBe("conflict")
    await act(async () => { await hook.result.current.refreshSharedState() })
    expect(hook.result.current.initialState).toEqual({ count: 17 })
    expect(hook.result.current.saveStatus).toBe("idle")
  })

  it("returns a 409 to the same conflict flow, showing the peer value", async () => {
    const hook = await mounted()
    server = { version: 3, value: { count: 9 } }
    write.mockRejectedValueOnce(new JazzAppletStateError(409))
    act(() => hook.result.current.persistState({ count: 3 }))
    await advance(305)
    expect(hook.result.current.saveStatus).toBe("conflict")
    expect(hook.result.current.conflictingSharedValue).toEqual({ count: 9 })
    await act(async () => { await hook.result.current.copyLocalDraft() })
    expect(clipboard).toHaveBeenCalledWith(JSON.stringify({ count: 3 }, null, 2))
    await act(async () => { await hook.result.current.refreshSharedState() })
    expect(hook.result.current.initialState).toEqual({ count: 9 })
  })

  it("discards a slow version-2 poll after displaying version 3; next write uses v3", async () => {
    const hook = await mounted()
    const slow = deferred<Remote>()
    read.mockImplementationOnce(() => slow.promise)

    await advance(1500)
    expect(read).toHaveBeenCalledTimes(2)
    server = { version: 3, value: { count: 3 } }
    await advance(1500)
    expect(read).toHaveBeenCalledTimes(3)
    expect(hook.result.current.initialState).toEqual({ count: 3 })

    await act(async () => { slow.resolve({ version: 2, value: { count: 2 } }) })
    expect(hook.result.current.initialState).toEqual({ count: 3 })
    act(() => hook.result.current.persistState({ count: 4 }))
    await advance(305)
    expect(write).toHaveBeenLastCalledWith(boardId, noteA, 3, { count: 4 })
  })

  it("drops a late response from an applet that was left", async () => {
    const initialOld = deferred<Remote>()
    read.mockImplementationOnce(() => initialOld.promise)
    const hook = renderHook(({ id }) => useAppletInitialState(id), {
      initialProps: { id: noteA },
    })
    await advance()
    expect(hook.result.current.stateLoaded).toBe(false)
    server = { version: 7, value: { count: 7 } }
    hook.rerender({ id: noteB })
    await advance()
    expect(hook.result.current.initialState).toEqual({ count: 7 })
    await act(async () => { initialOld.resolve({ version: 9, value: { count: 99 } }) })
    expect(hook.result.current.initialState).toEqual({ count: 7 })
  })

  it("enforces viewer access without submitting a write", async () => {
    board.canEdit = false
    const hook = await mounted()
    act(() => hook.result.current.persistState({ count: 10 }))
    await advance(500)
    expect(write).not.toHaveBeenCalled()
    expect(hook.result.current.saveStatus).toBe("idle")
  })
})
