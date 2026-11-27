import { disableJazzLinks, jazzLinks, jazzMembers, mintJazzLink, removeJazzMember, revokeJazzLink } from "./jazz-api"
import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { WarningIcon } from "@/components/icons"
import { Button } from "@/components/ui/button"

import {
  listBoardMembers,
  listShareLinks,
  mintShareLink,
  removeBoardMember,
  revokeAllShareLinks,
  shareLinkUrl,
  type BoardMember,
  type ShareRole,
} from "./api"


type ShareDialogProps = {
  jazz?: boolean
  boardId: string
  boardLabel: string
  open: boolean
  onOpenChange: (open: boolean) => void
}


/**
 * Owner's "Share this board" surface — pick a role, mint or revoke a
 * link, copy the URL, and manage who currently has access. Only
 * mounted for boards where the signed-in user's role is `"owner"`
 * (see [HarnessCanvas](../board/harness/canvas/harness-canvas.tsx)).
 */
export function ShareDialog({ jazz = false, boardId, boardLabel, open, onOpenChange }: ShareDialogProps) {
  const [selectedRole, setSelectedRole] = useState<ShareRole>("member")
  const queryClient = useQueryClient()

  const [minted, setMinted] = useState<{ id: string; role: ShareRole; url: string } | null>(null)
  const linksKey = ["shareLinks", boardId, jazz]
  const membersKey = ["boardMembers", boardId, jazz]
  const linksQuery = useQuery({
    queryKey: linksKey,
    queryFn: async () => jazz ? jazzLinks(boardId) : (await listShareLinks(boardId)).map(link => ({
      id: link.token, role: link.role, expires: 0, reusable: true,
    })),
    enabled: open,
  })

  const membersQuery = useQuery({
    queryKey: membersKey,
    queryFn: () => jazz ? jazzMembers(boardId) : listBoardMembers(boardId),
    enabled: open,
  })

  const mintMutation = useMutation({
    mutationFn: async (role: ShareRole) => {
      if (jazz) {
        const result = await mintJazzLink(boardId, role)
        setMinted({ id: result.invite_id, url: result.invite_url, role })
      } else await mintShareLink(boardId, role)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: linksKey }),
    onError: () => toast.error("Couldn't create share link. Try again."),
  })

  const revokeAllMutation = useMutation({
    mutationFn: () => jazz ? disableJazzLinks(boardId) : revokeAllShareLinks(boardId),
    onSuccess: (count) => {
      setMinted(null)
      queryClient.invalidateQueries({ queryKey: linksKey })
      toast.success(count === 0 ? "Sharing was already disabled." : `Disabled ${count} link(s).`)
    },
    onError: () => toast.error("Couldn't disable sharing. Try again."),
  })

  const removeMutation = useMutation({
    mutationFn: async (userUid: string) => {
      if (!jazz) return removeBoardMember(boardId, userUid)
      await removeJazzMember(boardId, userUid)
      return { kicked_sessions: 0 }
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: membersKey })
      const kickedNote = res.kicked_sessions > 0
        ? ` (${res.kicked_sessions} live session(s) closed)`
        : ""
      toast.success(`Removed from board.${kickedNote}`)
    },
    onError: () => toast.error("Couldn't remove member. Try again."),
  })

  const revoke = useMutation({
    mutationFn: (id: string) => revokeJazzLink(boardId, id),
    onSuccess: (_, id) => {
      if (minted?.id === id) setMinted(null)
      void queryClient.invalidateQueries({ queryKey: linksKey })
    },
    onError: () => toast.error("Could not revoke invitation."),
  })
  const activeLink = (linksQuery.data ?? []).find((l) => l.role === selectedRole) ?? null
  const otherLinks = (linksQuery.data ?? []).filter((l) => l.role !== selectedRole)

  const url = jazz ? (minted?.role === selectedRole && linksQuery.data?.some(link => link.id === minted.id) ? minted.url : "") :
    (activeLink ? shareLinkUrl(activeLink.id) : "")
  const copyLink = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast.success("Link copied to clipboard.")
    } catch {
      toast.error("Couldn't copy. Long-press to select.")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[86vh] overflow-y-auto">
        {/*
          `min-w-0` on the header lets the grid cell shrink to the
          dialog's `max-w-lg` instead of expanding to the title's
          intrinsic min-content width. Without it, a long board label
          forces the dialog wider than its max and overflows the
          viewport.
        */}
        <DialogHeader className="min-w-0">
          <DialogTitle className="truncate">
            Share &ldquo;{boardLabel || "Untitled board"}&rdquo;
          </DialogTitle>
        </DialogHeader>

        {/*
          Sharing is recursive: granting access to this board also grants
          access to every sub-folder, sub-note, and embedded document
          underneath. Surface that explicitly so the owner doesn't get
          surprised by a peer seeing a private note they forgot was
          nested in here.
        */}
        <div
          role="note"
          className="flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-100"
        >
          <WarningIcon className="mt-0.5 size-4 shrink-0" weight="fill" />
          <span>
            Sharing this board also shares every sub-board and nested
            note inside it. Move anything private out before inviting.
          </span>
        </div>

        <section className="flex flex-col gap-3">
          <div className="text-sm text-muted-foreground">Anyone with the link can:</div>
          <div className="flex items-center gap-2">
            <RoleToggle
              value="viewer"
              label="View"
              selected={selectedRole === "viewer"}
              onSelect={() => setSelectedRole("viewer")}
            />
            <RoleToggle
              value="member"
              label="Edit"
              selected={selectedRole === "member"}
              onSelect={() => setSelectedRole("member")}
            />
          </div>

          {url ? (
            <LinkRow
              url={url}
              onCopy={() => copyLink(url)}
            />
          ) : (
            <div className="flex items-center justify-between gap-2 rounded-md border border-dashed border-border bg-muted/40 p-3 text-sm">
              <span className="text-muted-foreground">
                {activeLink ? "Create a new link to copy and share." : "Create a link to invite people."}
              </span>
              <Button
                size="sm"
                onClick={() => mintMutation.mutate(selectedRole)}
                disabled={mintMutation.isPending}
              >
                {mintMutation.isPending ? "Creating…" : "Create link"}
              </Button>
            </div>
          )}

          {otherLinks.length > 0 && (
            <div className="text-xs text-muted-foreground">
              Switch role to see the other link
              {otherLinks.length > 1 ? "s" : ""} for this board.
            </div>
          )}

          {jazz && linksQuery.data?.map(link => (
            <div key={link.id} className="flex justify-between gap-2 text-sm">
              <span>{link.role === "member" ? "Edit" : "View"} · {link.reusable ? "Reusable" : "One-time"} · {link.expires === null ? "Never expires" : "expires " + new Date(link.expires).toLocaleDateString()}</span>
              <Button size="sm" variant="outline" disabled={revoke.isPending} onClick={() => revoke.mutate(link.id)}>Revoke</Button>
            </div>
          ))}
          {(membersQuery.isError || linksQuery.isError) && <p role="alert">Could not load sharing details. Reopen to retry.</p>}
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={() => {
                if (window.confirm("Disable sharing? Existing members keep access; only future invites are blocked.")) {
                  revokeAllMutation.mutate()
                }
              }}
              disabled={revokeAllMutation.isPending}
            >
              {revokeAllMutation.isPending ? "Disabling…" : "Disable sharing"}
            </Button>
          </div>
        </section>

        <hr className="my-2 border-border" />

        <section className="flex flex-col gap-2">
          <div className="text-sm font-medium">People with access</div>
          {membersQuery.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : (
            <ul className="flex flex-col gap-1">
              {(membersQuery.data ?? []).map((m) => (
                <MemberRow
                  key={m.user_uid}
                  member={m}
                  onRemove={() => {
                    if (window.confirm(`Remove ${m.email} from this board?`)) {
                      removeMutation.mutate(m.user_uid)
                    }
                  }}
                  removeBusy={removeMutation.isPending && removeMutation.variables === m.user_uid}
                />
              ))}
            </ul>
          )}
        </section>
        {jazz && <section className="space-y-2 border-t pt-3">
          <label className="text-sm font-medium" htmlFor="mcp-endpoint">Connect ChatGPT</label>
          <input id="mcp-endpoint" readOnly value={location.origin + "/patchboard-private-mcp"}
            onClick={event => event.currentTarget.select()} className="w-full text-xs" />
          <Button size="sm" variant="outline" onClick={() => void copyLink(location.origin + "/patchboard-private-mcp")}>Copy MCP endpoint</Button>
        </section>}
      </DialogContent>
    </Dialog>
  )
}


function RoleToggle({
  value,
  label,
  selected,
  onSelect,
}: { value: string; label: string; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={
        "rounded-md border px-3 py-1 text-sm transition-colors " +
        (selected
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-background text-foreground hover:bg-muted")
      }
      data-value={value}
    >
      {label}
    </button>
  )
}


function LinkRow({ url, onCopy }: { url: string; onCopy: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-background p-2">
      <input
        readOnly
        aria-label="Invitation link"
        value={url}
        onClick={(e) => (e.target as HTMLInputElement).select()}
        className="flex-1 truncate bg-transparent text-xs font-mono text-muted-foreground outline-none"
      />
      <Button size="sm" variant="secondary" onClick={onCopy}>
        Copy
      </Button>
    </div>
  )
}


function MemberRow({
  member,
  onRemove,
  removeBusy,
}: { member: BoardMember; onRemove: () => void; removeBusy: boolean }) {
  const isOwner = member.role === "owner"
  return (
    <li className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60">
      <div className="flex min-w-0 items-center gap-2">
        <span className="size-2 rounded-full bg-primary" aria-hidden="true" />
        <span className="truncate">{member.email}</span>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="capitalize">{member.role}</span>
        {!isOwner && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-1 text-destructive"
            onClick={onRemove}
            disabled={removeBusy}
          >
            {removeBusy ? "…" : "Remove"}
          </Button>
        )}
      </div>
    </li>
  )
}
