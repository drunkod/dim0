import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { useParams } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useBoardAppStore } from "../harness/store/board-app-store"
import { listViews, nativeSavedViewsEnabled, isViewDenied, type OwnerView } from "./saved-view-api"
import { SavedViewGrid } from "./saved-view-grid"
import { addRow, catalogRejection, createTable, saveView, type RowRequest, type TableRequest, type SaveViewRequest } from "./catalog-api"

type Pending = { kind: "table"; input: TableRequest } | { kind: "row"; input: RowRequest }

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
  const [epoch, setEpoch] = useState(0)
  const [tableName, setTableName] = useState("")
  const [fieldName, setFieldName] = useState("Title")
  const [defaultViewName, setDefaultViewName] = useState("All rows")
  const [value, setValue] = useState("")
  const [viewName, setViewName] = useState("")
  const [prefix, setPrefix] = useState("")
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const [problem, setProblem] = useState("")
  const [viewSaveUnknown, setViewSaveUnknown] = useState(false)
  const [listFailed, setListFailed] = useState(false)
  const write = useRef<AbortController | null>(null)
  const invalidate = useCallback(() => { write.current?.abort() }, [])
  useEffect(() => invalidate, [invalidate])

  useEffect(() => {
    const abort = new AbortController()
    void listViews(boardId, abort.signal).then(v => {
      if (abort.signal.aborted) return
      setViews(v)
      setListFailed(false)
    }).catch(error => {
      if (abort.signal.aborted) return
      setViews(null)
      setListFailed(!isViewDenied(error))
      setOpen(false)
    })
    return () => abort.abort()
  }, [boardId, epoch])

  const view = views?.find(v => v.viewId === selected)
  const primary = view?.singleTextTable && view.fields.length === 1 ? view.fields[0] : undefined
  const locked = busy || pending !== null || viewSaveUnknown

  async function submit(action: Pending) {
    if (write.current) return
    setPending(action)
    setBusy(true)
    setMessage("")
    setProblem("")
    const abort = new AbortController()
    write.current = abort
    try {
      if (action.kind === "table") {
        const result = await createTable(action.input, abort.signal)
        if (abort.signal.aborted) return
        setSelected(result.defaultViewId)
        setTableName("")
        setMessage("Table created.")
      } else {
        await addRow(action.input, abort.signal)
        if (abort.signal.aborted) return
        setValue("")
        setMessage("Row added.")
      }
      setPending(null)
      setEpoch(n => n + 1)
    } catch (error) {
      if (abort.signal.aborted) return
      const rejection = catalogRejection(error)
      if (rejection) {
        setPending(null)
        setProblem(rejection)
        if (isViewDenied(error)) { setViews(null); setOpen(false) }
        setEpoch(n => n + 1)
      } else {
        setProblem("Commit outcome unconfirmed. Retry the same request; its definition is locked.")
      }
    } finally {
      if (write.current === abort) write.current = null
      if (!abort.signal.aborted) setBusy(false)
    }
  }
  function newTable(event: FormEvent) {
    event.preventDefault()
    if (locked || !views) return
    void submit({ kind: "table", input: {
      board_id: boardId, request_id: crypto.randomUUID(), name: tableName.trim(),
      primary_field_name: fieldName.trim(), default_view_name: defaultViewName.trim(),
    } })
  }
  function newRow(event: FormEvent) {
    event.preventDefault()
    if (locked || !view || !primary) return
    void submit({ kind: "row", input: {
      board_id: boardId, dataset_id: view.datasetId, field_id: primary.id,
      schema_version: view.datasetSchemaVersion, value, request_id: crypto.randomUUID(),
    } })
  }
  async function newView(event: FormEvent) {
    event.preventDefault()
    if (locked || write.current || !view || !primary || !viewName.trim()) return
    const input: SaveViewRequest = { board_id: boardId, dataset_id: view.datasetId,
      definition: { name: viewName.trim(), allowed_field_ids: [primary.id],
        filter: { op: "text_prefix", field_id: primary.id, value: prefix },
        sort: { field_id: primary.id, direction: "asc" } } }
    const abort = new AbortController()
    write.current = abort
    setBusy(true)
    setMessage("")
    setProblem("")
    try {
      const result = await saveView(input, abort.signal)
      if (abort.signal.aborted) return
      setSelected(result.viewId)
      setViewName("")
      setPrefix("")
      setMessage("View saved.")
      setEpoch(n => n + 1)
    } catch (error) {
      if (abort.signal.aborted) return
      const rejection = catalogRejection(error)
      if (rejection) {
        setProblem(rejection)
        if (isViewDenied(error)) { setViews(null); setOpen(false) }
      } else {
        // Saved-view creation is not idempotent in #22. Do not blindly replay.
        setViewSaveUnknown(true)
        setProblem("Save view outcome unconfirmed. Refresh the view list and check whether it exists before creating again.")
      }
      setEpoch(n => n + 1)
    } finally {
      if (write.current === abort) write.current = null
      if (!abort.signal.aborted) setBusy(false)
    }
  }

  if (!views) return listFailed ? <Button size="sm" variant="ghost" onClick={() => setEpoch(n => n + 1)}>Retry Data</Button> : null
  const inputClass = "w-full rounded-md border bg-background px-2 py-1.5 text-sm disabled:opacity-60"
  return <>
    <button type="button" aria-label="Open board Data"
      className="flex items-center rounded-md px-1.5 py-1 text-xs font-medium text-card-foreground hover:opacity-70"
      onClick={() => { setOpen(true); setEpoch(n => n + 1) }}>Data</button>
    <Sheet open={open} onOpenChange={next => { if (!busy) setOpen(next) }}>
      <SheetContent className="w-full max-w-lg overflow-y-auto">
        <SheetHeader><SheetTitle>Board Data</SheetTitle><SheetDescription>Create primary-text tables and read-only saved views.</SheetDescription></SheetHeader>
        <section aria-label="Board Data" className="space-y-4 px-4 pb-6">
          {views.length === 0 && <p className="text-sm text-muted-foreground">No saved views on this board.</p>}
          <form aria-label="Create text table" className="space-y-2 rounded-md border p-3" onSubmit={newTable}>
            <h3 className="text-sm font-medium">Create text table</h3>
            <label className="block text-xs">Table name<input className={inputClass} required maxLength={80} value={tableName} disabled={locked} onChange={e => setTableName(e.target.value)} /></label>
            <label className="block text-xs">Primary text field<input className={inputClass} required maxLength={80} value={fieldName} disabled={locked} onChange={e => setFieldName(e.target.value)} /></label>
            <label className="block text-xs">Default grid name<input className={inputClass} required maxLength={80} value={defaultViewName} disabled={locked} onChange={e => setDefaultViewName(e.target.value)} /></label>
            <Button type="submit" size="sm" disabled={locked || !tableName.trim() || !fieldName.trim() || !defaultViewName.trim()}>Create table</Button>
          </form>
          {pending && <Button size="sm" disabled={busy} onClick={() => void submit(pending)}>
            {pending.kind === "table" ? "Retry Create table" : "Retry Add row"}
          </Button>}
          {message && <p role="status" className="text-sm">{message}</p>}
          {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
          {viewSaveUnknown && <Button size="sm" variant="outline" onClick={() => { setEpoch(n => n + 1); setViewSaveUnknown(false) }}>Refresh and review saved views</Button>}
          {[...new Set(views.map(v => v.datasetId))].map(id => {
            const group = views.filter(v => v.datasetId === id)
            return <section key={id} className="space-y-2">
              <h3 className="text-sm font-semibold">{group[0].datasetName}</h3>
              <div className="flex flex-wrap gap-2">{group.map(v => <Button key={v.viewId} size="sm" variant="outline"
                aria-label={"Open saved view " + v.name} aria-pressed={selected === v.viewId}
                disabled={locked} onClick={() => setSelected(v.viewId)}>{v.name}</Button>)}</div>
            </section>
          })}
          {open && view && <SavedViewGrid key={view.viewId + ":" + epoch} view={view} />}
          {view && primary && <>
            <form aria-label="Add text row" onSubmit={newRow} className="space-y-2 rounded-md border p-3">
              <label className="block text-xs">New row {primary.name}<input className={inputClass} required maxLength={2000}
                value={value} disabled={locked} onChange={e => setValue(e.target.value)} /></label>
              <Button type="submit" size="sm" disabled={locked || !value.trim()}>Add row</Button>
            </form>
            <form aria-label="Save filtered view" onSubmit={newView} className="space-y-2 rounded-md border p-3">
              <label className="block text-xs">Saved view name<input className={inputClass} required maxLength={80} value={viewName} disabled={locked} onChange={e => setViewName(e.target.value)} /></label>
              <label className="block text-xs">{primary.name} starts with<input className={inputClass} maxLength={80} value={prefix} disabled={locked} onChange={e => setPrefix(e.target.value)} /></label>
              <Button type="submit" size="sm" disabled={locked || !viewName.trim()}>Save view</Button>
            </form>
          </>}
        </section>
      </SheetContent>
    </Sheet>
  </>
}
