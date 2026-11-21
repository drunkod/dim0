import { useEffect, useState, type FormEvent } from "react"
import { useNavigate } from "@tanstack/react-router"

type Session = { signedIn: boolean; name?: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Small standalone launchpad for the opt-in Jazz-backed Dim0 prototype.
 * It creates boards through the authenticated private backend, not Dim0 SQL.
 */
export function JazzSignInPage() {
  const navigate = useNavigate()
  const [session, setSession] = useState<Session | null>(null)
  const [title, setTitle] = useState("Dim0 + Jazz prototype")
  const [boardId, setBoardId] = useState("")
  const [recentBoard, setRecentBoard] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    try {
      const stored = localStorage.getItem("dim0:jazz:recent-board")
      if (stored && UUID.test(stored)) setRecentBoard(stored)
    } catch { /* Private browsing may disable storage. */ }
    void fetch("/patchboard-private/api/me", {
      credentials: "include",
      cache: "no-store",
    }).then(async (res) => {
      if (!res.ok) throw new Error("Private Jazz service is unavailable")
      const next = await res.json() as Session
      if (!cancelled) setSession(next)
    }).catch(() => { if (!cancelled) setError("Private Jazz service is unavailable") })
    return () => { cancelled = true }
  }, [])

  const openBoard = (id: string) => {
    const value = id.trim()
    if (!UUID.test(value)) { setError("Enter a valid Jazz board UUID"); return }
    try { localStorage.setItem("dim0:jazz:recent-board", value) } catch { /* optional */ }
    void navigate({ to: "/boards/$id", params: { id: value } })
  }

  const createBoard = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!title.trim() || busy) return
    setBusy(true)
    setError("")
    try {
      const response = await fetch("/patchboard-private/api/boards", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: title.trim() }),
      })
      if (!response.ok) throw new Error("Could not create board (HTTP " + response.status + ")")
      const created = await response.json() as { board_id?: string }
      if (!created.board_id || !UUID.test(created.board_id)) throw new Error("Invalid new board ID")
      openBoard(created.board_id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create board")
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-5 px-6 text-foreground">
      <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Experimental local MVP</div>
      <h1 className="text-3xl font-semibold">Dim0 + Jazz canvas</h1>
      <p className="text-sm text-muted-foreground">
        A live Dim0 whiteboard backed by the private Jazz database and MCP canvas tools.
        This prototype runs on your MacBook; offline recovery is still in development.
      </p>
      {error && <div role="alert" className="rounded-md border border-destructive p-3 text-sm">{error}</div>}
      {session === null ? (
        <p role="status" className="text-sm">Checking private Jazz sign-in…</p>
      ) : !session.signedIn ? (
        <div className="flex flex-col gap-3">
          <p>Use your private Patchboard passkey to create a Jazz session.</p>
          <a href="/patchboard-private/" className="rounded-lg bg-primary px-4 py-3 text-center font-medium text-primary-foreground">
            Sign in or create passkey
          </a>
          <p className="text-xs text-muted-foreground">After signing in, return to /jazz-signin to create or open a board.</p>
        </div>
      ) : (
        <>
          <p role="status" className="text-sm">Signed in as {session.name || "Jazz account"}</p>
          <form onSubmit={createBoard} className="flex flex-col gap-3">
            <label htmlFor="jazz-board-title" className="font-medium">New board</label>
            <input id="jazz-board-title" className="rounded-lg border bg-background px-3 py-3" value={title}
              maxLength={80} onChange={(event) => setTitle(event.target.value)} />
            <button type="submit" disabled={busy || !title.trim()}
              className="rounded-lg bg-primary px-4 py-3 font-medium text-primary-foreground disabled:opacity-50">
              {busy ? "Creating…" : "Create Jazz board"}
            </button>
          </form>
          <form onSubmit={(event) => { event.preventDefault(); openBoard(boardId) }} className="flex flex-col gap-3">
            <label htmlFor="jazz-board-id" className="font-medium">Open an existing Jazz board</label>
            <input id="jazz-board-id" className="rounded-lg border bg-background px-3 py-3" value={boardId}
              placeholder="Board UUID" onChange={(event) => setBoardId(event.target.value)} />
            <button type="submit" className="rounded-lg border px-4 py-3 font-medium">Open board</button>
          </form>
          {recentBoard && <button type="button" onClick={() => openBoard(recentBoard)}
            className="text-left text-sm underline">Reopen recent board: {recentBoard}</button>}
        </>
      )}
    </main>
  )
}
