import { useEffect, useState } from "react"
import { useParams } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import { savePendingJazzInvitation } from "./jazz-auth-client"

type Status = "loading" | "signed-out" | "ready" | "joining" | "invalid"
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const tokenFormat = /^[\w-]{43}$/

/** Anyone can open the URL, but Jazz membership is created by the signed-in server. */
export function JazzInviteLandingPage() {
  const params = useParams({ strict: false }) as { id?: string }
  const boardId = params.id ?? ""
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get("invite") ?? "")
  const [status, setStatus] = useState<Status>("loading")
  const [error, setError] = useState("")

  useEffect(() => {
    if (!uuid.test(boardId) || !tokenFormat.test(token)) {
      setStatus("invalid")
      setError("This invitation URL is incomplete. Ask the owner to create a new link.")
      return
    }
    let cancelled = false
    void fetch("/patchboard-private/api/me", { credentials: "include", cache: "no-store" })
      .then((response) => response.json())
      .then((account: { signedIn?: boolean }) => {
        if (!cancelled) setStatus(account.signedIn ? "ready" : "signed-out")
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("invalid")
          setError("The shared-board service is temporarily unavailable.")
        }
      })
    return () => { cancelled = true }
  }, [boardId, token])

  const signIn = () => {
    // Preserve the secret in this tab, not in the server request URL or referrer.
    savePendingJazzInvitation(boardId, token)
    window.location.assign("/jazz-signin")
  }

  const accept = async () => {
    setStatus("joining")
    setError("")
    try {
      const res = await fetch("/patchboard-private/api/join", {
        method: "POST", credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ board_id: boardId, token }),
      })
      if (!res.ok) throw new Error(res.status === 404
        ? "This link has expired or been revoked. Ask the owner for a new invite."
        : "Unable to join board (HTTP " + res.status + ").")
      sessionStorage.removeItem("dim0:jazz:pendingInvite")
      window.location.replace("/boards/" + boardId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not join board")
      setStatus("ready")
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-5 px-6">
      <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
        Dim0 · Jazz collaboration
      </span>
      <h1 className="text-3xl font-semibold">You've been invited to a board</h1>
      <p className="text-sm text-muted-foreground">
        Join the live infinite canvas to work with your friends and their AI agents.
        Your board identity is your Jazz passkey; afterwards connect your own ChatGPT
        account using the MCP endpoint provided in the board's Share dialog.
      </p>
      {status === "loading" && <p role="status">Checking account…</p>}
      {status === "signed-out" && <Button onClick={signIn}>Sign in or create a passkey to join</Button>}
      {status === "ready" && <Button onClick={() => void accept()}>Join the collaborative board</Button>}
      {status === "joining" && <p role="status">Joining your board…</p>}
      {status === "invalid" && <a className="underline" href="/jazz-signin">Open Jazz home</a>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </main>
  )
}
