import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

type InviteInfo = { id: string; role: "editor" | "viewer"; reusable: boolean; expires_at: number }
type MemberInfo = { id: string; role: string }
type Props = { boardId: string; boardLabel: string; open: boolean; onOpenChange: (open: boolean) => void }
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

/** Jazz-backed version of Dim0's existing Share dialog. No legacy Postgres routes. */
export function JazzShareDialog({ boardId, boardLabel, open, onOpenChange }: Props) {
  const [role, setRole] = useState<"editor" | "viewer">("editor")
  const [link, setLink] = useState("")
  const [invites, setInvites] = useState<InviteInfo[]>([])
  const [members, setMembers] = useState<MemberInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const mcpUrl = typeof window === "undefined" ? "" : location.origin + "/patchboard-private-mcp"

  const refresh = useCallback(async () => {
    const query = "?board_id=" + encodeURIComponent(boardId)
    const [a, b] = await Promise.all([
      api<{ invites: InviteInfo[] }>("invites" + query),
      api<{ members: MemberInfo[] }>("members" + query),
    ])
    setInvites(a.invites)
    setMembers(b.members)
  }, [boardId])

  useEffect(() => {
    if (!open) return
    setError("")
    setLink("")
    void refresh().catch((cause) => setError(String(cause)))
  }, [open, refresh])

  const act = async (fn: () => Promise<unknown>, success?: string) => {
    setLoading(true)
    setError("")
    try {
      await fn()
      if (success) toast.success(success)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sharing request failed")
    } finally { setLoading(false) }
  }

  const create = () => act(async () => {
    const result = await api<{ invite_url: string }>("invite", {
      board_id: boardId, role, reusable: true,
    })
    setLink(result.invite_url)
  }, "Reusable invite created. Copy this link for your friends.")

  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); toast.success("Copied to clipboard") }
    catch { toast.error("Select and copy the link manually") }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[86vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="truncate">Share “{boardLabel || "Jazz board"}”</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Invite friends to this live Jazz board. Each friend signs in with a separate passkey,
          and can then connect their own ChatGPT account to the MCP server.
        </p>
        <section className="space-y-3">
          <label className="block text-sm font-medium" htmlFor="jazz-invite-role">Anyone with this link may</label>
          <select id="jazz-invite-role" value={role}
            onChange={(event) => setRole(event.target.value as "editor" | "viewer")}
            className="w-full rounded-md border bg-background p-2 text-sm">
            <option value="editor">Edit the board (human + AI tools)</option>
            <option value="viewer">View only</option>
          </select>
          <Button onClick={() => void create()} disabled={loading} className="w-full">
            {loading ? "Working…" : "Create share link for multiple friends"}
          </Button>
          {link && (
            <div className="space-y-2">
              <label htmlFor="jazz-invite-link" className="text-sm font-medium">Your invite link</label>
              <input id="jazz-invite-link" readOnly value={link} onClick={(e) => e.currentTarget.select()}
                className="w-full rounded-md border bg-muted/40 p-2 text-xs" />
              <Button size="sm" onClick={() => void copy(link)}>Copy invite link</Button>
              <p className="text-xs text-muted-foreground">
                Save the link now. Only a hash is stored in Jazz; existing link secrets cannot be displayed again.
              </p>
            </div>
          )}
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Active invitations</h3>
            {invites.length === 0 && <p className="text-xs text-muted-foreground">No active links yet.</p>}
            {invites.map((invite) => (
              <div key={invite.id} className="flex items-center justify-between gap-2 rounded-md border p-2 text-xs">
                <span>{invite.role === "editor" ? "Can edit" : "Can view"} · {invite.reusable ? "Reusable" : "One-time"} · expires {new Date(invite.expires_at).toLocaleDateString()}</span>
                <Button variant="outline" size="sm" disabled={loading}
                  onClick={() => void act(() => api("invites/revoke", {
                    board_id: boardId, invite_id: invite.id,
                  }), "Invite revoked")}>Revoke</Button>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-medium">People with access</h3>
            {members.map((member) => (
              <div key={member.id} className="flex items-center justify-between gap-2 rounded-md border p-2 text-xs">
                <span className="truncate">{member.role} · {member.id.slice(0, 8)}…</span>
                {member.role !== "owner" && <Button variant="outline" size="sm" disabled={loading}
                  onClick={() => void act(() => api("members/remove", {
                    board_id: boardId, user_id: member.id,
                  }), "Member removed")}>Remove</Button>}
              </div>
            ))}
          </div>
        </section>
        <section className="space-y-2 border-t pt-3">
          <h3 className="text-sm font-medium">Connect each person’s ChatGPT</h3>
          <p className="text-xs text-muted-foreground">
            In their own chatgpt.com account, open Plugins → Add custom MCP server,
            paste this endpoint, and use Connect to sign in with the same Jazz passkey.
            Select this board and approve read/write scopes.
          </p>
          <input aria-label="MCP server URL" readOnly value={mcpUrl}
            onClick={(e) => e.currentTarget.select()}
            className="w-full rounded-md border bg-muted/40 p-2 text-xs" />
          <Button size="sm" variant="outline" onClick={() => void copy(mcpUrl)}>Copy MCP endpoint</Button>
        </section>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  )
}
