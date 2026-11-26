import { useEffect, useState } from "react"
import { useParams } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useBoardAppStore } from "../harness/store/board-app-store"
import { listViews, nativeSavedViewsEnabled, type OwnerView } from "./saved-view-api"
import { SavedViewGrid } from "./saved-view-grid"

export function NativeBoardDataControl() {
  const { id } = useParams({ strict: false }) as { id?: string }
  const boardId = useBoardAppStore(s => s.boardId)
  const role = useBoardAppStore(s => s.boardRole)
  const presenting = useBoardAppStore(s => s.presentationMode)
  if (!nativeSavedViewsEnabled || !id || id !== boardId || role !== "owner" || presenting) return null
  return <NativeBoardData key={id} boardId={id} />
}

export function NativeBoardData({ boardId }: { boardId: string }) {
  const [views, setViews] = useState<OwnerView[] | null>(null)
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<string>()
  useEffect(() => {
    const abort = new AbortController()
    void listViews(boardId, abort.signal).then(v => { if (!abort.signal.aborted) setViews(v) }).catch(() => { if (!abort.signal.aborted) setViews(null) })
    return () => abort.abort()
  }, [boardId])
  if (!views) return null
  const view = views.find(v => v.viewId === selected)
  return <>
    <button type="button" aria-label="Open board Data"
      className="flex items-center rounded-md px-1.5 py-1 text-xs font-medium text-card-foreground hover:opacity-70"
      onClick={() => setOpen(true)}>Data</button>
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent className="w-full max-w-lg overflow-y-auto">
        <SheetHeader><SheetTitle>Board Data</SheetTitle><SheetDescription>Read-only saved views from the board’s Jazz records.</SheetDescription></SheetHeader>
        <section aria-label="Board Data" className="space-y-4 px-4 pb-6">
          {views.length === 0 && <p className="text-sm text-muted-foreground">No saved views on this board.</p>}
          {views.map(v => <Button key={v.viewId} size="sm" variant="outline" aria-label={"Open saved view " + v.name}
            aria-pressed={selected === v.viewId} onClick={() => setSelected(v.viewId)}>{v.name}</Button>)}
          {open && view && <SavedViewGrid key={view.viewId} view={view} />}
        </section>
      </SheetContent>
    </Sheet>
  </>
}
