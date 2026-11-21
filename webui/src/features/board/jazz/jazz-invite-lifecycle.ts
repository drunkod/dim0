/** The invitation secret stays in the browser tab until Jazz confirms redemption. */
export type PendingJazzInvitation = { boardId: string; token: string }

export type JazzInviteRedemption =
  | { status: "none" }
  | { status: "joined"; boardId: string }
  | { status: "invalid"; message: string }
  | { status: "retryable"; message: string }

/**
 * Only a confirmed 404 makes a link terminal; temporary network and server
 * errors preserve it for retry. The caller must clear ONLY the matching code,
 * so a new invitation pasted during an in-flight request cannot be lost.
 */
export async function redeemJazzInvite(
  pending: PendingJazzInvitation | null,
  join: (pending: PendingJazzInvitation) => Promise<{ ok: boolean; status: number }>,
  clearIfCurrent: (pending: PendingJazzInvitation) => void,
): Promise<JazzInviteRedemption> {
  if (!pending) return { status: "none" }
  let response: { ok: boolean; status: number }
  try {
    response = await join(pending)
  } catch {
    return { status: "retryable", message: "Invitation service unavailable. Retry when connected or cancel the invitation." }
  }
  if (response.status === 404) {
    clearIfCurrent(pending)
    return { status: "invalid", message: "Invitation expired or revoked. Ask the owner for a fresh link." }
  }
  if (!response.ok) {
    return { status: "retryable", message: "Could not join board (HTTP " + response.status + "). Retry or cancel the invitation." }
  }
  clearIfCurrent(pending)
  return { status: "joined", boardId: pending.boardId }
}

/**
 * ChatGPT's signed OAuth flow has precedence over unrelated saved invites.
 * Keeps PKCE/state validation within the existing Better Auth provider.
 */
export async function continueJazzSignIn(
  resumeOAuth: () => boolean,
  redeem: () => Promise<JazzInviteRedemption>,
  loadBoards: () => Promise<void>,
): Promise<JazzInviteRedemption | { status: "oauth" }> {
  if (resumeOAuth()) return { status: "oauth" }
  const result = await redeem()
  if (result.status !== "joined") await loadBoards()
  return result
}
