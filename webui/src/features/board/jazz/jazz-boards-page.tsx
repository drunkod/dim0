import { JazzLogoutButton } from "@/features/signin/components/jazz-logout-button"
import { useEffect, useState, type FormEvent } from "react"
import { useNavigate } from "@tanstack/react-router"
import {
  currentJazzIdentity,
  redeemPendingJazzInvitation, readPendingJazzInvitation, clearPendingJazzInvitation,
  continueJazzOAuth, type JazzIdentity,
} from "./jazz-auth-client"
import { continueJazzSignIn } from "./jazz-invite-lifecycle"

type Board = { board_id: string; title: string; role: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Board list and invitation recovery for signed-in members.
 * Does not load the old Patchboard application or legacy Dim0 SQL endpoints.
 */
export function JazzBoardsPage() {
  const navigate = useNavigate()
  const [session, setSession] = useState<JazzIdentity | null | undefined>(undefined)
  const [boards, setBoards] = useState<Board[]>([])
  const [title, setTitle] = useState("My collaborative board")
  const [boardId, setBoardId] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [pendingInvite, setPendingInvite] = useState(() => readPendingJazzInvitation())
  const [sessionUnavailable, setSessionUnavailable] = useState(false)

  const openBoard = (id: string) => {
    if (!UUID.test(id)) { setError("Enter a valid Jazz board ID"); return }
    void navigate({ to: "/boards/$id", params: { id } })
  }

  const loadBoards = async () => {
    const response = await fetch("/patchboard-private/api/boards", {
      credentials: "include", cache: "no-store",
    })
    if (!response.ok) throw new Error("Cannot load your Jazz boards")
    const data = await response.json() as { boards: Board[] }
    setBoards(data.boards)
  }

  const afterIdentity = async (identity: JazzIdentity) => {
    setSession(identity)
    // An explicitly requested ChatGPT OAuth consent always takes precedence
    // over a stale invitation left in this tab.
    const outcome = await continueJazzSignIn(continueJazzOAuth,
      redeemPendingJazzInvitation, loadBoards)
    if (outcome.status === "joined") { setPendingInvite(null); openBoard(outcome.boardId) }
    else if (outcome.status === "invalid") {
      setPendingInvite(null)
      setError(outcome.message)
    } else if (outcome.status === "retryable") setError(outcome.message)
  }

  useEffect(() => {
    let cancelled = false
    void currentJazzIdentity().then(async (identity) => {
      if (cancelled) return
      if (!identity) { window.location.replace("/signin"); return }
      setSession(identity)
      if (identity) {
        try { await afterIdentity(identity) }
        catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to load Jazz boards") }
      }
    }).catch((cause) => {
      if (!cancelled) {
        setError(cause instanceof Error ? cause.message : "Jazz sign-in unavailable")
        setSessionUnavailable(true)
      }
    })
    return () => { cancelled = true }
    // The landing page handles changes by navigation, not by re-running effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const createBoard = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!title.trim() || busy) return
    setBusy(true)
    setError("")
    try {
      const response = await fetch("/patchboard-private/api/boards", {
        method: "POST", credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: title.trim() }),
      })
      if (!response.ok) throw new Error("Could not create board (HTTP " + response.status + ")")
      const created = await response.json() as { board_id?: string }
      if (!created.board_id || !UUID.test(created.board_id)) throw new Error("Invalid new board ID")
      openBoard(created.board_id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create board")
    } finally { setBusy(false) }
  }

  const retryInvite = async () => {
    if (!session || busy) return
    setBusy(true)
    setError("")
    try { await afterIdentity(session) }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not retry invitation") }
    finally { setBusy(false) }
  }

  const cancelInvite = () => {
    clearPendingJazzInvitation()
    setPendingInvite(null)
    setError("")
    if (session) void loadBoards().catch((cause) => setError(String(cause)))
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-5 px-6 py-10 text-foreground">
      <h1 className="text-3xl font-semibold">Boards</h1>
      {pendingInvite && (
        <div role="status" className="rounded-lg border bg-muted/30 p-3 text-sm">
          {session ? "Invitation pending. Retry to join or cancel to use your other boards." :
            "Your invitation is ready. Sign in to join the board."}
          {session && <div className="mt-2 flex gap-3">
            <button type="button" disabled={busy} onClick={() => void retryInvite()}
              className="underline underline-offset-2">Retry invitation</button>
            <button type="button" disabled={busy} onClick={cancelInvite}
              className="underline underline-offset-2">Cancel invitation</button>
          </div>}
        </div>
      )}
      {error && <p role="alert" className="rounded-lg border border-destructive p-3 text-sm text-destructive">{error}</p>}
      {session === undefined ? (
        <div role="status" className="text-sm">Checking Jazz session…
          {sessionUnavailable && <button type="button" className="ml-2 underline"
            onClick={() => window.location.reload()}>Retry connection</button>}
        </div>
      ) : session && (
        <>
          <div className="flex items-center justify-between gap-3 text-sm">
            <p role="status">Signed in as <strong>{session.name}</strong></p>
            <JazzLogoutButton />
          </div>
          {boards.length > 0 && (
            <section className="space-y-2">
              <h2 className="font-medium">Your boards</h2>
              {boards.map((board) => (
                <button type="button" key={board.board_id} onClick={() => openBoard(board.board_id)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg border bg-background p-3 text-left hover:bg-muted">
                  <span className="truncate">{board.title}</span>
                  <span className="text-xs text-muted-foreground">{board.role === "owner" ? "Owner" : board.role === "editor" ? "Editor" : "Viewer"}</span>
                </button>
              ))}
            </section>
          )}
          <form onSubmit={(event) => void createBoard(event)} className="flex flex-col gap-3">
            <label htmlFor="jazz-board-title" className="font-medium">Create a board</label>
            <input id="jazz-board-title" className="rounded-lg border bg-background px-3 py-3"
              value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} />
            <button type="submit" disabled={busy || !title.trim()}
              className="rounded-lg bg-primary px-4 py-3 font-medium text-primary-foreground disabled:opacity-50">
              {busy ? "Creating…" : "Create board"}
            </button>
          </form>
          <form onSubmit={(event) => { event.preventDefault(); openBoard(boardId.trim()) }}
            className="flex flex-col gap-2">
            <label htmlFor="jazz-board-id" className="text-sm font-medium">Open by board ID</label>
            <input id="jazz-board-id" className="rounded-lg border bg-background px-3 py-3"
              value={boardId} placeholder="Board UUID" onChange={(event) => setBoardId(event.target.value)} />
            <button type="submit" className="rounded-lg border px-4 py-3 font-medium">Open board</button>
          </form>
        </>
      )}
    </main>
  )
}
