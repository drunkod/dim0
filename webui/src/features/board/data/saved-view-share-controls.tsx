import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { issueShare, listShares, listViews, revokeShare, sharedViewUrl, type OwnerView, type ViewShare } from "./saved-view-api"

export function SavedViewShareControls({ boardId }: { boardId: string }) {
  const [views, setViews] = useState<OwnerView[] | null>(null)
  useEffect(() => {
    const abort = new AbortController()
    void listViews(boardId, abort.signal).then(v => { if (!abort.signal.aborted) setViews(v) }).catch(() => { if (!abort.signal.aborted) setViews(null) })
    return () => abort.abort()
  }, [boardId])
  if (!views?.length) return null
  return <section aria-label="Saved view links" className="space-y-3 border-t pt-3">
    <h3 className="text-sm font-medium">Saved view links</h3>
    <p className="text-xs text-muted-foreground">Read-only view links show only permitted rows and fields. They do not grant board membership. Anyone with a link who signs in may read the view until revoked.</p>
    {views.map(view => <ViewShareRow key={view.viewId} view={view} />)}
  </section>
}
function ViewShareRow({ view }: { view: OwnerView }) {
  const [shares, setShares] = useState<ViewShare[]>([])
  const [minted, setMinted] = useState<{ shareId: string; url: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    const abort = new AbortController()
    void listShares(view, abort.signal).then(s => { if (!abort.signal.aborted) setShares(s) }).catch(() => {
      if (!abort.signal.aborted) { setShares([]); setMinted(null); setMessage("Could not load view links.") }
    })
    return () => abort.abort()
  }, [view, refresh])
  async function create() {
    setBusy(true); setMessage(""); setMinted(null)
    try {
      const issued = await issueShare(view, new AbortController().signal)
      setMinted({ shareId: issued.shareId, url: sharedViewUrl({ ...view, shareToken: issued.shareToken }) })
      setRefresh(n => n + 1)
    } catch { setMessage("Could not create view link. Reopen sharing to check.") }
    finally { setBusy(false) }
  }
  async function revoke(s: ViewShare) {
    setBusy(true); setMessage(""); setMinted(null)
    try {
      const result = await revokeShare(view, s, new AbortController().signal)
      setShares(old => old.map(row => row.shareId === s.shareId ? result : row))
      setMessage("View link revoked.")
    } catch { setMessage("Could not confirm revocation. Refresh sharing details.") }
    finally { setBusy(false); setRefresh(n => n + 1) }
  }
  return <div role="group" aria-label={"Share saved view " + view.name} className="space-y-2 rounded-md border p-3">
    <h4 className="text-sm font-medium">{view.name}</h4>
    <Button size="sm" variant="outline" disabled={busy} onClick={() => void create()}>Create view link</Button>
    {minted && shares.some(s => s.shareId === minted.shareId && !s.revoked) &&
      <Button size="sm" onClick={() => void navigator.clipboard.writeText(minted.url).then(() => setMessage("View link copied.")).catch(() => setMessage("Clipboard unavailable."))}>Copy view link</Button>}
    {shares.map(s => <div key={s.shareId} className="flex items-center justify-between gap-2 text-xs">
      <span>{s.revoked ? "Revoked" : "Active view link"} · {s.shareId.slice(0, 8)}</span>
      {!s.revoked && <Button size="sm" variant="outline" disabled={busy} onClick={() => void revoke(s)}>Revoke view link</Button>}
    </div>)}
    {message && <p role="status" className="text-xs">{message}</p>}
  </div>
}
