import type { BoardMember, ShareRole } from "./api"

type InviteInfo = { id: string; role: "editor" | "viewer"; reusable: boolean; expires_at: number | null }
type MemberInfo = { id: string; role: string; name?: string | null; role_version?: number | null }
const root = "/patchboard-private/api/"

async function api<T>(endpoint: string, data?: object): Promise<T> {
  const res = await fetch(root + endpoint, {
    ...(data ? { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(data) } : {}),
    credentials: "include", cache: "no-store",
  })
  if (!res.ok) throw new Error("Sharing request failed (HTTP " + res.status + ")")
  return res.json() as Promise<T>
}


/** Adapt the Jazz role and grant identifiers to Dim0's sharing controls. */
export async function jazzMembers(boardId: string): Promise<BoardMember[]> {
  const { members } = await api<{ members: MemberInfo[] }>("members?board_id=" + encodeURIComponent(boardId))
  return members.map(member => ({
    user_uid: member.id,
    // The original Dim0 row renders "email". Pass the verified display name
    // instead of falsely labeling Jazz UUIDs as email addresses.
    email: member.name?.trim()
      ? member.name.trim() + " · " + member.id.slice(0, 8)
      : "Member · " + member.id.slice(0, 8),
    role: member.role === "owner" ? "owner" :
      member.role === "editor" ? "member" :
      member.role === "agent" ? "agent" :
      member.role === "admin" ? "admin" : "viewer",
    role_version: member.role === "editor" || member.role === "viewer"
      ? member.role_version ?? null : null,
    joined_at: null,
  }))
}

export async function jazzLinks(boardId: string) {
  const { invites } = await api<{ invites: InviteInfo[] }>("invites?board_id=" + encodeURIComponent(boardId))
  return invites.map(invite => ({ id: invite.id, role: invite.role === "editor" ? "member" as const : "viewer" as const,
    expires: invite.expires_at, reusable: invite.reusable }))
}

export function mintJazzLink(boardId: string, role: ShareRole) {
  return api<{ invite_url: string; invite_id: string }>("invite", {
    board_id: boardId, role: role === "member" ? "editor" : "viewer", reusable: true,
  })
}

export async function disableJazzLinks(boardId: string) {
  return (await api<{ revoked_count: number }>("invites/revoke-all", { board_id: boardId })).revoked_count
}

export function revokeJazzLink(boardId: string, id: string) {
  return api("invites/revoke", { board_id: boardId, invite_id: id })
}

export function removeJazzMember(boardId: string, id: string) {
  return api("members/remove", { board_id: boardId, user_id: id })
}


/**
 * Real native board Editor/Viewer role mutation under current Jazz owner;
 * a Space inherited role, Teable Creator/Commenter, admin or agent is NOT
 * reinterpreted here. The server checks expected member version atomically.
 */
export async function updateJazzMemberRole(
  boardId: string, memberId: string,
  assigned: "member" | "viewer", expectedVersion: number
): Promise<{ assigned_role: "editor" | "viewer"; role_version: number; changed: boolean }> {
  return api("members/role", {
    board_id: boardId, user_id: memberId,
    role: assigned === "member" ? "editor" : "viewer",
    expected_version: expectedVersion, request_id: crypto.randomUUID(),
  })
}
