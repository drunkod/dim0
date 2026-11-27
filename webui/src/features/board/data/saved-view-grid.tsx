import { useCopy } from "@/i18n"
import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { isStaleCursor, queryGrid, viewErrorText, type ViewPage, type ViewRef, type Recipient } from "./saved-view-api"

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; page: ViewPage; cursor?: string }

/** Each request owns a generation. Even a non-cooperative fetch cannot paint
 * after a newer denial, a view change, or unmount. Clear rows/count at start. */
export function SavedViewGrid({ view }: { view: ViewRef | Recipient }) {
  const { t } = useCopy()
  const [state, setState] = useState<State>({ kind: "loading" })
  const [notice, setNotice] = useState("")
  const generation = useRef(0)
  const pending = useRef<AbortController | null>(null)
  const currentCursor = useRef<string | undefined>(undefined)
  const load = useCallback(async (cursor?: string) => {
    const id = ++generation.current
    pending.current?.abort()
    const abort = new AbortController()
    pending.current = abort
    currentCursor.current = cursor
    setNotice("")
    setState({ kind: "loading" })
    try {
      let result: ViewPage
      try { result = await queryGrid(view, abort.signal, cursor) }
      catch (error) {
        if (id !== generation.current || abort.signal.aborted) return
        if (!cursor || !isStaleCursor(error)) throw error
        currentCursor.current = undefined
        cursor = undefined
        setNotice("The view changed. Showing a fresh first page.")
        result = await queryGrid(view, abort.signal)
      }
      if (id === generation.current && !abort.signal.aborted) setState({ kind: "ready", page: result, cursor })
    } catch (error) {
      if (id === generation.current && !abort.signal.aborted) {
        currentCursor.current = undefined
        setNotice("")
        setState({ kind: "error", message: viewErrorText(error) })
      }
    }
  }, [view])
  const invalidate = useCallback(() => { ++generation.current; pending.current?.abort() }, [])
  useEffect(() => {
    void load()
    return invalidate
  }, [load, invalidate])
  const ready = state.kind === "ready" ? state : null
  return <section aria-label={t("Saved view")} className="space-y-3">
    {notice && <p role="status" className="text-sm text-muted-foreground">{t(notice)}</p>}
    {state.kind === "loading" && <p role="status">{t("Loading grid…")}</p>}
    {state.kind === "error" && <p role="alert" className="text-sm text-destructive">{t(state.message)}</p>}
    {ready && <>
      <h2 className="text-lg font-semibold">{ready.page.name}</h2>
      <div className="overflow-auto rounded-md border">
        <table data-dataset-id={ready.page.datasetId} data-view-id={ready.page.viewId} aria-label={t("Saved view records")} className="w-full border-collapse text-sm">
          <thead className="bg-muted"><tr>{ready.page.columns.map(c => <th key={c.id} data-field-id={c.id} scope="col" className="border-b p-3 text-left">{c.name}</th>)}</tr></thead>
          <tbody>{ready.page.rows.map(row => <tr key={row.id} data-record-id={row.id}>{ready.page.columns.map(c => {
            const cell = row.cells[c.id]
            return <td key={c.id} className="break-words border-b p-3">{typeof cell === "string" || typeof cell === "number" || typeof cell === "boolean" ? String(cell) : ""}</td>
          })}</tr>)}</tbody>
        </table>
      </div>
      <p className="text-sm text-muted-foreground">{t("{{count}} matching records", { count: ready.page.total })}</p>
    </>}
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" disabled={!ready?.cursor} onClick={() => void load()}>{t("First page")}</Button>
      <Button size="sm" variant="outline" disabled={!ready?.page.nextCursor} onClick={() => void load(ready?.page.nextCursor ?? undefined)}>{t("Next page")}</Button>
      <Button size="sm" variant="outline" onClick={() => void load(currentCursor.current)}>{t("Refresh view")}</Button>
    </div>
  </section>
}
