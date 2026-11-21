import { useEffect, useState } from "react"
import { useParams } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import { Status as InviteStatus, SignInPanel, ReadyPanel, ErrorPanel } from "@/features/sharing/screens/invite-panels"
import { currentJazzIdentity, redeemPendingJazzInvitation, savePendingJazzInvitation } from "./jazz-auth-client"

type Status = "loading" | "signed-out" | "ready" | "joining" | "invalid" | "retry"
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const tokenFormat = /^[\w-]{43}$/

/** Anyone can open the URL, but Jazz membership is created by the signed-in server. */
export function JazzInviteLandingPage() {
  const params = useParams({ strict: false }) as { id?: string }
  const boardId = params.id ?? ""
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get("invite") ?? "")
  const [status, setStatus] = useState<Status>("loading")
  const [role, setRole] = useState<"member" | "viewer">()
  const [error, setError] = useState("")

  useEffect(() => {
    if (!uuid.test(boardId) || !tokenFormat.test(token)) {
      setStatus("invalid")
      setError("This invitation URL is incomplete. Ask the owner to create a new link.")
      return
    }
    let cancelled = false
    void currentJazzIdentity().then(async identity => {
      if (cancelled) return
      if (!identity) { setStatus("signed-out"); return }
      const response = await fetch("/patchboard-private/api/invites/preview", {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" },
        body: JSON.stringify({ board_id: boardId, token }),
      })
      if (cancelled) return
      if (response.status === 404) {
        setError("This invitation has expired or been revoked.")
        setStatus("invalid")
        return
      }
      if (!response.ok) throw new Error("Invitation unavailable")
      const info = await response.json() as { role: "editor" | "viewer" }
      if (!cancelled) {
        setRole(info.role === "editor" ? "member" : "viewer")
        setStatus("ready")
      }
    }).catch(() => {
      if (!cancelled) setStatus("retry")
    })
    return () => { cancelled = true }
  }, [boardId, token])

  const signIn = () => {
    // Preserve the secret in this tab, not in the server request URL or referrer.
    savePendingJazzInvitation(boardId, token)
    window.location.assign("/signin")
  }

  const accept = async () => {
    setStatus("joining")
    setError("")
    try {
      savePendingJazzInvitation(boardId, token)
      const result = await redeemPendingJazzInvitation()
      if (result.status === "joined") window.location.replace("/boards/" + result.boardId)
      else if (result.status === "invalid" || result.status === "retryable") {
        setError(result.message)
        setStatus(result.status === "invalid" ? "invalid" : "ready")
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not join board")
      setStatus("ready")
    }
  }

  return (
    <main className="mx-auto max-w-md p-6">
      <div className="rounded-2xl border border-border bg-background p-6 shadow-md">
        {status === "loading" && <InviteStatus text="Checking invitation…" />}
        {status === "signed-out" && <SignInPanel onGoSignIn={signIn} />}
        {status === "ready" && <ReadyPanel role={role} onOpen={() => void accept()} />}
        {status === "joining" && <InviteStatus text="Joining the board…" />}
        {status === "invalid" && <ErrorPanel message={error} onGoHome={() => location.assign("/boards")} />}
        {status === "retry" && <><p>Could not load the invitation.</p><Button onClick={() => location.reload()}>Retry</Button></>}
        {error && status !== "invalid" && <p role="alert">{error}</p>}
      </div>
    </main>
  )
}
