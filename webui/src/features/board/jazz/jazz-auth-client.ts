import { createAuthClient } from "better-auth/client"
import { passkeyClient } from "@better-auth/passkey/client"
import { redeemJazzInvite, type JazzInviteRedemption } from "./jazz-invite-lifecycle"

/**
 * Native Dim0 passkey entry point. The verified session and OAuth protocol
 * remain on the same origin as the Jazz API; no Patchboard app UI is needed.
 */
const client = createAuthClient({
  baseURL: window.location.origin,
  basePath: "/patchboard-auth",
  plugins: [passkeyClient()],
})

export type JazzIdentity = { id: string; name: string; accountId: string }

export async function currentJazzIdentity(): Promise<JazzIdentity | null> {
  const response = await fetch("/patchboard-private/api/me", {
    credentials: "include", cache: "no-store",
  })
  if (!response.ok) throw new Error("Jazz authentication is temporarily unavailable")
  const data = await response.json() as { signedIn?: boolean } & Partial<JazzIdentity>
  if (!data.signedIn) return null
  if (!data.id || !data.name || !data.accountId) throw new Error("Incomplete Jazz account")
  return { id: data.id, name: data.name, accountId: data.accountId }
}

export async function createJazzAccount(): Promise<JazzIdentity> {
  const response = await fetch("/patchboard-private/api/registration-intent", {
    method: "POST", credentials: "include",
    headers: { "content-type": "application/json" }, body: "{}",
  })
  if (!response.ok) throw new Error("Unable to create passkey registration (" + response.status + ")")
  const intent = await response.json() as { context?: string }
  if (!intent.context) throw new Error("Missing verified registration intent")
  const result = await client.passkey.addPasskey({
    context: intent.context, createSession: true, name: "Dim0 passkey",
  })
  if (result.error) throw new Error(result.error.message ?? "Passkey creation failed")
  const identity = await currentJazzIdentity()
  if (!identity) throw new Error("Passkey did not establish an authenticated session")
  return identity
}

export async function signInToJazz(): Promise<JazzIdentity> {
  const result = await client.signIn.passkey()
  if (result.error) throw new Error(result.error.message ?? "Passkey sign-in failed")
  const identity = await currentJazzIdentity()
  if (!identity) throw new Error("Passkey did not establish an authenticated session")
  return identity
}

export async function signOutOfJazz(): Promise<void> {
  const result = await client.signOut()
  if (result.error) throw new Error(result.error.message ?? "Unable to sign out")
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const inviteCode = /^[\w-]{43}$/
const pendingKey = "dim0:jazz:pendingInvite"

export function savePendingJazzInvitation(boardId: string, code: string) {
  if (!uuid.test(boardId) || !inviteCode.test(code)) throw new Error("Invalid invitation")
  sessionStorage.setItem(pendingKey, JSON.stringify({ boardId, token: code }))
}

export function readPendingJazzInvitation(): { boardId: string; token: string } | null {
  try {
    const input = sessionStorage.getItem(pendingKey)
    const data = input ? JSON.parse(input) as { boardId?: string; token?: string } : null
    if (data && typeof data.boardId === "string" && uuid.test(data.boardId) &&
        typeof data.token === "string" && inviteCode.test(data.token)) return data as { boardId: string; token: string }
  } catch { /* No storage available or stale object. */ }
  return null
}

export function clearPendingJazzInvitation(expected?: { boardId: string; token: string }): void {
  if (!expected || (readPendingJazzInvitation()?.boardId === expected.boardId &&
      readPendingJazzInvitation()?.token === expected.token)) {
    sessionStorage.removeItem(pendingKey)
  }
}

export async function redeemPendingJazzInvitation(): Promise<JazzInviteRedemption> {
  return redeemJazzInvite(readPendingJazzInvitation(), async (pending) => fetch(
    "/patchboard-private/api/join", {
      method: "POST", credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ board_id: pending.boardId, token: pending.token }),
    },
  ), clearPendingJazzInvitation)
}

/** Preserve OAuth PKCE/state, but never follow caller-provided callback URLs. */
export function continueJazzOAuth(): boolean {
  const request = new URLSearchParams(location.search)
  if (!request.has("sig") || !request.has("client_id")) return false
  const authorize = new URL("/patchboard-auth/oauth2/authorize", location.origin)
  for (const key of ["client_id", "redirect_uri", "response_type", "code_challenge",
    "code_challenge_method", "scope", "state", "resource", "nonce"]) {
    for (const value of request.getAll(key)) authorize.searchParams.append(key, value)
  }
  location.replace(authorize.href)
  return true
}
