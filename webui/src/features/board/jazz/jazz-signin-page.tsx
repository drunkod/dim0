import { useEffect, useState, type FormEvent } from "react"
import { useNavigate } from "@tanstack/react-router"
import {
  createJazzAccount, currentJazzIdentity, signInToJazz, signOutOfJazz,
  redeemPendingJazzInvitation, readPendingJazzInvitation, continueJazzOAuth,
  type JazzIdentity,
} from "./jazz-auth-client"

type Board = { board_id: string; title: string; role: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The only login/dashboard for the experimental Jazz-powered Dim0.
 * Does not load the old Patchboard application or legacy Dim0 SQL endpoints.
 */
export function JazzSignInPage() {
  const navigate = useNavigate()
  const [session, setSession] = useState<JazzIdentity | null | undefined>(undefined)
  const [boards, setBoards] = useState<Board[]>([])
  const [title, setTitle] = useState("My collaborative board")
  const [boardId, setBoardId] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

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
    // An invitation is redeemed by the authenticated Jazz server, atomically.
    // Only navigate when the server confirms the membership.
    const acceptedBoard = await redeemPendingJazzInvitation()
    if (acceptedBoard) { openBoard(acceptedBoard); return }
    if (continueJazzOAuth()) return
    await loadBoards()
  }

  useEffect(() => {
    let cancelled = false
    void currentJazzIdentity().then(async (identity) => {
      if (cancelled) return
      if (identity) await afterIdentity(identity)
      else setSession(null)
    }).catch((cause) => {
      if (!cancelled) {
        setError(cause instanceof Error ? cause.message : "Jazz sign-in unavailable")
        setSession(null)
      }
    })
    return () => { cancelled = true }
    // The landing page handles changes by navigation, not by re-running effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const authenticate = async (action: "create" | "login") => {
    if (busy) return
    setBusy(true)
    setError("")
    try {
      const identity = action === "create" ? await createJazzAccount() : await signInToJazz()
      await afterIdentity(identity)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Passkey sign-in failed")
    } finally { setBusy(false) }
  }

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

  const signOut = async () => {
    setBusy(true)
    try {
      await signOutOfJazz()
      setSession(null)
      setBoards([])
      setError("")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign out")
    } finally { setBusy(false) }
  }

  const pendingInvite = readPendingJazzInvitation()
  const oauthLogin = new URLSearchParams(location.search).has("client_id")

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-5 px-6 py-10 text-foreground">
      <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
        Dim0 · Jazz collaborative workspace
      </div>
      <h1 className="text-3xl font-semibold">Your collaborative canvas</h1>
      <p className="text-sm text-muted-foreground">
        All board entities, invitations and memberships use Jazz Tools. Sign in with a
        passkey to collaborate in Dim0 and authorize your own ChatGPT MCP connection.
      </p>
      {pendingInvite && (
        <div role="status" className="rounded-lg border bg-muted/30 p-3 text-sm">
          Your invitation is ready. Sign in to join the board.
        </div>
      )}
      {oauthLogin && (
        <div role="status" className="rounded-lg border bg-muted/30 p-3 text-sm">
          Sign in to continue authorizing the board for your ChatGPT account.
        </div>
      )}
      {error && <p role="alert" className="rounded-lg border border-destructive p-3 text-sm text-destructive">{error}</p>}
      {session === undefined ? (
        <p role="status" className="text-sm">Checking Jazz session…</p>
      ) : session === null ? (
        <section className="flex flex-col gap-3">
          <button type="button" onClick={() => void authenticate("create")} disabled={busy}
            className="rounded-lg bg-primary px-4 py-3 font-medium text-primary-foreground disabled:opacity-50">
            {busy ? "Please wait…" : "Create account with passkey"}
          </button>
          <button type="button" onClick={() => void authenticate("login")} disabled={busy}
            className="rounded-lg border bg-background px-4 py-3 font-medium disabled:opacity-50">
            Sign in with passkey
          </button>
        </section>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 text-sm">
            <p role="status">Signed in as <strong>{session.name}</strong></p>
            <button type="button" disabled={busy} onClick={() => void signOut()}
              className="underline underline-offset-2">Sign out</button>
          </div>
          {boards.length > 0 && (
            <section className="space-y-2">
              <h2 className="font-medium">Your Jazz boards</h2>
              {boards.map((board) => (
                <button type="button" key={board.board_id} onClick={() => openBoard(board.board_id)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg border bg-background p-3 text-left hover:bg-muted">
                  <span className="truncate">{board.title}</span>
                  <span className="text-xs text-muted-foreground">{board.role === "owner" ? "Owner" : board.role === "member" ? "Editor" : "Viewer"}</span>
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
              {busy ? "Creating…" : "Create Jazz board"}
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
