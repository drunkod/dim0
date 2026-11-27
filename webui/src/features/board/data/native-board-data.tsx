import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { useParams } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useBoardAppStore } from "../harness/store/board-app-store"
import { listViews, nativeSavedViewsEnabled, nativeCatalogReadOnly, nativePersistentTextCatalogEnabled, isViewDenied, type OwnerView } from "./saved-view-api"
import { SavedViewGrid } from "./saved-view-grid"
import { addRow, catalogRejection, createTable, saveView } from "./catalog-api"
import { currentJazzIdentity } from "../jazz/jazz-auth-client"
import { readCatalogIntent, retainCatalogIntent, releaseCatalogIntent, type CatalogIntent, type CatalogIntentScope } from "./catalog-intent"

type DataProps = { boardId: string; readOnly?: boolean; allowSaveView?: boolean }
const unknownOutcome = "Commit outcome unconfirmed. Retry the same request; its definition is locked."
const unknownView = "Save view outcome unconfirmed. Refresh the view list and check whether it exists before creating again."
const journalProblem = "Browser retry storage is unavailable or changed. No new catalog writes are allowed; reload this board to check the original request."

function restore(scope?: CatalogIntentScope) {
  try { return { intent: scope ? readCatalogIntent(scope) : null, blocked: false } }
  catch { return { intent: null, blocked: true } }
}

export function NativeBoardDataControl() {
  const { id } = useParams({ strict: false }) as { id?: string }
  const boardId = useBoardAppStore(s => s.boardId)
  const role = useBoardAppStore(s => s.boardRole)
  const presenting = useBoardAppStore(s => s.presentationMode)
  if ((!nativeSavedViewsEnabled && !nativeCatalogReadOnly && !nativePersistentTextCatalogEnabled) || !id || id !== boardId || role !== "owner" || presenting) return null
  return <NativeBoardData key={id} boardId={id} readOnly={nativeCatalogReadOnly} allowSaveView={!nativePersistentTextCatalogEnabled} />
}

export function NativeBoardData(props: DataProps) {
  const { boardId, readOnly = false } = props
  const [scope, setScope] = useState<CatalogIntentScope | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (readOnly) return
    let active = true
    void currentJazzIdentity().then(identity => {
      if (!identity) throw new Error("No verified account")
      if (active) {
        setScope({ subjectId: identity.id, accountId: identity.accountId, boardId })
        setFailed(false)
      }
    }).catch(() => { if (active) { setScope(null); setFailed(true) } })
    return () => { active = false }
  }, [boardId, readOnly, attempt])
  if (readOnly) return <NativeBoardDataPanel key={boardId} {...props} />
  if (!scope || scope.boardId !== boardId) return failed ? <Button size="sm" variant="ghost" onClick={() => setAttempt(n => n + 1)}>Retry Data</Button> : null
  return <NativeBoardDataPanel key={JSON.stringify(scope)} {...props} scope={scope} />
}

function NativeBoardDataPanel({ boardId, readOnly = false, allowSaveView = true, scope }: DataProps & { scope?: CatalogIntentScope }) {
  const [restored] = useState(() => restore(scope))
  const [pending, setPending] = useState<CatalogIntent | null>(restored.intent)
  const [storageBlocked, setStorageBlocked] = useState(restored.blocked)
  const [views, setViews] = useState<OwnerView[] | null>(null)
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<string | undefined>(restored.intent && restored.intent.kind !== "table" ? restored.intent.viewId : undefined)
  const [epoch, setEpoch] = useState(0)
  const [tableName, setTableName] = useState(restored.intent?.kind === "table" ? restored.intent.input.name : "")
  const [fieldName, setFieldName] = useState(restored.intent?.kind === "table" ? restored.intent.input.primary_field_name : "Title")
  const [defaultViewName, setDefaultViewName] = useState(restored.intent?.kind === "table" ? restored.intent.input.default_view_name : "All rows")
  const [value, setValue] = useState(restored.intent?.kind === "row" ? restored.intent.input.value : "")
  const [viewName, setViewName] = useState(restored.intent?.kind === "view-review" ? restored.intent.input.definition.name : "")
  const [prefix, setPrefix] = useState(restored.intent?.kind === "view-review" ? restored.intent.input.definition.filter.value : "")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const [problem, setProblem] = useState(restored.blocked ? journalProblem : restored.intent ? (restored.intent.kind === "view-review" ? unknownView : unknownOutcome) : "")
  const [reviewEpoch, setReviewEpoch] = useState<number | null>(null)
  const [loadedEpoch, setLoadedEpoch] = useState<number | null>(null)
  const [listFailed, setListFailed] = useState(false)
  const write = useRef<AbortController | null>(null)
  const invalidate = useCallback(() => { write.current?.abort() }, [])
  useEffect(() => invalidate, [invalidate])

  useEffect(() => {
    const abort = new AbortController()
    void listViews(boardId, abort.signal).then(v => {
      if (abort.signal.aborted) return
      setViews(v)
      setLoadedEpoch(epoch)
      setListFailed(false)
    }).catch(error => {
      if (abort.signal.aborted) return
      setViews(null)
      setLoadedEpoch(null)
      setListFailed(!isViewDenied(error))
      setOpen(false)
    })
    return () => abort.abort()
  }, [boardId, epoch])

  const view = views?.find(v => v.viewId === selected)
  const primary = view?.singleTextTable && view.fields.length === 1 ? view.fields[0] : undefined
  const locked = busy || pending !== null || storageBlocked
  const reviewed = pending?.kind === "view-review" && reviewEpoch === epoch && loadedEpoch === epoch

  async function submit(action: CatalogIntent, retry = false) {
    if (readOnly || !scope || storageBlocked || write.current || (action.kind === "view-review" && (!allowSaveView || retry))) return
    setBusy(true)
    setMessage("")
    setProblem("")
    const abort = new AbortController()
    write.current = abort
    let journaled = false
    let confirmed = false
    try {
      // A session change must not submit an old account's frozen row value.
      const identity = await currentJazzIdentity()
      if (abort.signal.aborted) return
      if (!identity || identity.id !== scope.subjectId || identity.accountId !== scope.accountId) {
        setProblem("Account changed. Reopen Data with the original account.")
        setStorageBlocked(true)
        return
      }
      try {
        retainCatalogIntent(scope, action, retry)
      } catch {
        setStorageBlocked(true)
        setProblem(journalProblem)
        return
      }
      journaled = true
      setPending(action)
      setReviewEpoch(null)
      if (action.kind === "table") {
        const result = await createTable(action.input, abort.signal)
        if (abort.signal.aborted) return
        confirmed = true
        setSelected(result.defaultViewId)
        setTableName("")
        setMessage("Table created.")
      } else if (action.kind === "row") {
        const result = await addRow(action.input, abort.signal)
        if (abort.signal.aborted) return
        if (result.updatedBy !== scope.accountId) throw new Error("Row writer mismatch")
        confirmed = true
        setSelected(action.viewId)
        setValue("")
        setMessage("Row added.")
      } else {
        const result = await saveView(action.input, abort.signal)
        if (abort.signal.aborted) return
        confirmed = true
        setSelected(result.viewId)
        setViewName("")
        setPrefix("")
        setMessage("View saved.")
      }
      releaseCatalogIntent(scope, action)
      setPending(null)
      setEpoch(n => n + 1)
    } catch (error) {
      if (abort.signal.aborted) return
      if (confirmed) {
        setStorageBlocked(true)
        setProblem("Write confirmed, but its browser retry record could not be cleared. Reload this board to review.")
        setEpoch(n => n + 1)
      } else if (!journaled) {
        setProblem("Unable to verify the account. No catalog request was sent.")
      } else {
        const rejection = catalogRejection(error)
        // A rejection of a replay cannot establish that the earlier attempt
        // did not commit. Only a definitive rejection of the first attempt
        // may release the frozen intent.
        if (rejection && !retry) {
          try {
            releaseCatalogIntent(scope, action)
            setPending(null)
            setProblem(rejection)
          } catch {
            setStorageBlocked(true)
            setProblem(journalProblem)
          }
          if (isViewDenied(error)) { setViews(null); setOpen(false) }
          setEpoch(n => n + 1)
        } else {
          setProblem(action.kind === "view-review" ? unknownView : (rejection ? "Retry did not confirm the original outcome. " + rejection : unknownOutcome))
          if (isViewDenied(error)) { setViews(null); setOpen(false); setEpoch(n => n + 1) }
          else if (action.kind === "view-review") setEpoch(n => n + 1)
        }
      }
    } finally {
      if (write.current === abort) write.current = null
      if (!abort.signal.aborted) setBusy(false)
    }
  }
  function newTable(event: FormEvent) {
    event.preventDefault()
    if (readOnly || locked || !views) return
    void submit({ kind: "table", input: {
      board_id: boardId, request_id: crypto.randomUUID(), name: tableName.trim(),
      primary_field_name: fieldName.trim(), default_view_name: defaultViewName.trim(),
    } })
  }
  function newRow(event: FormEvent) {
    event.preventDefault()
    if (readOnly || locked || !view || !primary) return
    void submit({ kind: "row", viewId: view.viewId, input: {
      board_id: boardId, dataset_id: view.datasetId, field_id: primary.id,
      schema_version: view.datasetSchemaVersion, value, request_id: crypto.randomUUID(),
    } })
  }
  function newView(event: FormEvent) {
    event.preventDefault()
    if (readOnly || !allowSaveView || locked || write.current || !view || !primary || !viewName.trim()) return
    // Save view has no server idempotency receipt. Keep a review marker, never
    // replay it automatically or unlock a second create after a failed refresh.
    void submit({ kind: "view-review", reviewId: crypto.randomUUID(), viewId: view.viewId,
      input: { board_id: boardId, dataset_id: view.datasetId,
        definition: { name: viewName.trim(), allowed_field_ids: [primary.id],
          filter: { op: "text_prefix", field_id: primary.id, value: prefix },
          sort: { field_id: primary.id, direction: "asc" } } } })
  }
  async function acknowledgeViewReview() {
    if (!scope || !reviewed || !pending || pending.kind !== "view-review" || storageBlocked || write.current) return
    const abort = new AbortController()
    write.current = abort
    setBusy(true)
    try {
      const identity = await currentJazzIdentity()
      if (abort.signal.aborted) return
      if (!identity || identity.id !== scope.subjectId || identity.accountId !== scope.accountId) throw new Error("Account changed")
      releaseCatalogIntent(scope, pending)
      setPending(null)
      setReviewEpoch(null)
      setProblem("")
      setViewName("")
      setPrefix("")
      setMessage("View list reviewed. No save request was replayed.")
    } catch {
      if (!abort.signal.aborted) setProblem("Unable to confirm review. The original save remains locked.")
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
        <SheetHeader><SheetTitle>Board Data</SheetTitle><SheetDescription>{readOnly ? "Read-only catalog rehearsal. Create tables through the authorized MCP connection." : allowSaveView ? "Create primary-text tables and read-only saved views." : "Create primary-text tables and add rows."}</SheetDescription></SheetHeader>
        <section aria-label="Board Data" className="space-y-4 px-4 pb-6">
          {views.length === 0 && <p className="text-sm text-muted-foreground">No saved views on this board.</p>}
          {!readOnly && <form aria-label="Create text table" className="space-y-2 rounded-md border p-3" onSubmit={newTable}>
            <h3 className="text-sm font-medium">Create text table</h3>
            <label className="block text-xs">Table name<input className={inputClass} required maxLength={80} value={tableName} disabled={locked} onChange={e => setTableName(e.target.value)} /></label>
            <label className="block text-xs">Primary text field<input className={inputClass} required maxLength={80} value={fieldName} disabled={locked} onChange={e => setFieldName(e.target.value)} /></label>
            <label className="block text-xs">Default grid name<input className={inputClass} required maxLength={80} value={defaultViewName} disabled={locked} onChange={e => setDefaultViewName(e.target.value)} /></label>
            <Button type="submit" size="sm" disabled={locked || !tableName.trim() || !fieldName.trim() || !defaultViewName.trim()}>Create table</Button>
          </form>}
          {pending && pending.kind !== "view-review" && !readOnly && <Button size="sm" disabled={busy || storageBlocked} onClick={() => void submit(pending, true)}>
            {pending.kind === "table" ? "Retry Create table" : "Retry Add row"}
          </Button>}
          {message && <p role="status" className="text-sm">{message}</p>}
          {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
          {pending?.kind === "view-review" && <>
            <Button size="sm" variant="outline" disabled={busy || storageBlocked} onClick={() => { setReviewEpoch(epoch + 1); setEpoch(n => n + 1) }}>Refresh and review saved views</Button>
            {reviewed && <Button size="sm" variant="outline" disabled={busy || storageBlocked} onClick={() => void acknowledgeViewReview()}>I reviewed the saved views</Button>}
          </>}
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
          {!readOnly && view && primary && <>
            <form aria-label="Add text row" onSubmit={newRow} className="space-y-2 rounded-md border p-3">
              <label className="block text-xs">New row {primary.name}<input className={inputClass} required maxLength={2000}
                value={value} disabled={locked} onChange={e => setValue(e.target.value)} /></label>
              <Button type="submit" size="sm" disabled={locked || !value.trim()}>Add row</Button>
            </form>
            {allowSaveView && <form aria-label="Save filtered view" onSubmit={newView} className="space-y-2 rounded-md border p-3">
              <label className="block text-xs">Saved view name<input className={inputClass} required maxLength={80} value={viewName} disabled={locked} onChange={e => setViewName(e.target.value)} /></label>
              <label className="block text-xs">{primary.name} starts with<input className={inputClass} maxLength={80} value={prefix} disabled={locked} onChange={e => setPrefix(e.target.value)} /></label>
              <Button type="submit" size="sm" disabled={locked || !viewName.trim()}>Save view</Button>
            </form>}
          </>}
        </section>
      </SheetContent>
    </Sheet>
  </>
}
