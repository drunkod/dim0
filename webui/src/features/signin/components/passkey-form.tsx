import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { continueJazzOAuth, createJazzAccount, currentJazzIdentity, readPendingJazzInvitation, signInToJazz } from "@/features/board/jazz/jazz-auth-client"


/** Continue OAuth on its original query, or let the board list finish a pending invitation. */
function enterWorkspace() {
  if (continueJazzOAuth()) return
  const destination = new URLSearchParams(location.search).get("next")
  if (!readPendingJazzInvitation() && destination?.startsWith("/boards/")) {
    const target = new URL(destination, location.origin)
    if (target.origin === location.origin && target.pathname.startsWith("/boards/")) {
      location.replace(target.href)
      return
    }
  }
  location.replace("/boards")
}


/** Use the passkey provider inside Dim0's existing sign-in and registration cards. */
export function PasskeyForm({ mode }: { mode: "signin" | "signup" }) {
  const signup = mode === "signup"
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState("")
  useEffect(() => {
    let active = true
    currentJazzIdentity().then(identity => {
      if (active && identity) enterWorkspace()
    }).catch(cause => {
      if (active) setError(String(cause))
    }).finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [])

  async function submit() {
    setBusy(true)
    setError("")
    try {
      await (signup ? createJazzAccount() : signInToJazz())
      enterWorkspace()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Passkey request failed")
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {new URLSearchParams(location.search).has("client_id") && <p className="text-sm">Sign in to continue connecting ChatGPT.</p>}
      {readPendingJazzInvitation() && <p className="text-sm">Sign in to join the shared board.</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button disabled={busy} className="w-full" onClick={() => void submit()}>
        {signup ? "Create account with passkey" : "Sign in with passkey"}
      </Button>
      <a className="text-sm underline" href={(signup ? "/signin" : "/signup") + location.search}>
        {signup ? "Sign in" : "Create an account"}
      </a>
    </div>
  )
}
