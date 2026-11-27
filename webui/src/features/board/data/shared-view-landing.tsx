import { useEffect, useState } from "react"
import { useRouterState } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import { currentJazzIdentity, createJazzAccount, signInToJazz } from "../jazz/jazz-auth-client"
import { nativeSavedViewsEnabled, readRecipient } from "./saved-view-api"
import { SavedViewGrid } from "./saved-view-grid"

/** Separate route, no board fetch or invitation redemption. Keep the bearer
 * in the fragment, including through the existing native passkey operations. */
export function SharedViewLanding() {
  const href = useRouterState({ select: state => state.location.href })
  if (!nativeSavedViewsEnabled) return <main className="p-8"><h1>Saved view unavailable</h1></main>
  return <Landing key={href} href={href} />
}
function Landing({ href }: { href: string }) {
  const [recipient] = useState(() => readRecipient(href))
  const [state, setState] = useState<"checking" | "signed-out" | "ready" | "error">("checking")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  useEffect(() => {
    if (!recipient) return
    let active = true
    void currentJazzIdentity().then(identity => { if (active) setState(identity ? "ready" : "signed-out") }).catch(() => { if (active) setState("error") })
    return () => { active = false }
  }, [recipient])
  async function authenticate(create: boolean) {
    setBusy(true); setError(false)
    try { await (create ? createJazzAccount() : signInToJazz()); setState("ready") }
    catch { setError(true) }
    finally { setBusy(false) }
  }
  return <main className="mx-auto h-full max-w-xl overflow-y-auto p-6">
    <div className="space-y-5 rounded-xl border bg-card p-5 shadow-sm">
      <h1 className="text-2xl font-semibold">Shared saved view</h1>
      <p className="text-sm text-muted-foreground">Read-only · This link does not join the board.</p>
      {!recipient ? <p role="alert">Saved view link is invalid.</p> :
        state === "checking" ? <p role="status">Checking account…</p> :
        state === "error" ? <><p role="alert">Unable to check account.</p><Button onClick={() => location.reload()}>Retry</Button></> :
        state === "signed-out" ? <div className="space-y-3">
          <p>Sign in to read this view.</p>
          <Button disabled={busy} onClick={() => void authenticate(false)}>Sign in with passkey</Button>
          <Button disabled={busy} variant="outline" onClick={() => void authenticate(true)}>Create account with passkey</Button>
          {error && <p role="alert">Passkey authentication failed. Retry.</p>}
        </div> : <SavedViewGrid view={recipient} />}
    </div>
  </main>
}
