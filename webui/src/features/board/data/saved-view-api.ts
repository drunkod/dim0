import { z } from "zod"

export const nativeCatalogReadOnly = import.meta.env.VITE_DIM0_JAZZ_CANVAS === "1" &&
  import.meta.env.VITE_DIM0_QA_NATIVE_CATALOG_READONLY === "1"
export const nativePersistentTextCatalogEnabled = !nativeCatalogReadOnly && import.meta.env.VITE_DIM0_JAZZ_CANVAS === "1" &&
  import.meta.env.VITE_DIM0_PERSISTENT_TEXT_CATALOG === "1"
export const nativePersistentFilteredSharingEnabled = nativePersistentTextCatalogEnabled &&
  import.meta.env.VITE_DIM0_PERSISTENT_FILTERED_SHARING === "1"
export const nativeSavedViewsEnabled = !nativeCatalogReadOnly && import.meta.env.VITE_DIM0_JAZZ_CANVAS === "1" &&
  (nativePersistentTextCatalogEnabled ? nativePersistentFilteredSharingEnabled : import.meta.env.VITE_DIM0_QA_NATIVE_SAVED_VIEW === "1")
const uuid = z.string().uuid()
const field = z.object({ id: uuid, name: z.string() })
const view = z.object({
  boardId: uuid, datasetId: uuid, viewId: uuid, viewVersion: z.number().int().positive(),
  name: z.string(), fields: z.array(field),
  datasetName: z.string(), datasetSchemaVersion: z.number().int().positive(), singleTextTable: z.boolean(),
})
const page = z.object({
  boardId: uuid, datasetId: uuid, viewId: uuid, viewVersion: z.number().int().positive(),
  name: z.string(), columns: z.array(field), fields: z.array(uuid),
  rows: z.array(z.object({ id: uuid, version: z.number().int().positive(), cells: z.record(z.string(), z.unknown()) })),
  total: z.number().int().nonnegative(), nextCursor: z.string().nullable(),
})
const share = z.object({ shareId: uuid, shareVersion: z.number().int().positive(), revoked: z.boolean() })
export type OwnerView = z.infer<typeof view>
export type ViewPage = z.infer<typeof page>
export type ViewShare = z.infer<typeof share>
export type ViewRef = { boardId: string; datasetId: string; viewId: string }
export type Recipient = ViewRef & { shareToken: string }
const recipient = z.object({ boardId: uuid, datasetId: uuid, viewId: uuid, shareToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })

export class ViewError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string) { super("Saved view request failed"); this.name = "ViewError"; this.status = status; this.code = code }
}
export const isViewDenied = (e: unknown) => e instanceof ViewError && [401, 403, 404].includes(e.status)
export const isStaleCursor = (e: unknown) => e instanceof ViewError && e.status === 409 && e.code === "VIEW_CURSOR_REQUIRES_FRESH_QUERY"
export function viewErrorText(e: unknown) {
  if (isViewDenied(e)) return "Access to this view has been revoked or is unavailable."
  if (e instanceof ViewError && e.code === "VIEW_DATASET_LIMIT_500") return nativePersistentTextCatalogEnabled ? "This view exceeds the 500-record limit. No partial results are shown." : "This view exceeds the 500-record QA limit. No partial results are shown."
  return "Unable to load this view. Retry when connected."
}
export async function request(path: string, signal: AbortSignal, body?: object): Promise<unknown> {
  const response = await fetch("/patchboard-private/api/records/" + path, {
    credentials: "same-origin", cache: "no-store", redirect: "error", signal,
    ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  })
  if (!response.ok) {
    const raw: unknown = await response.json().catch(() => null)
    const code = z.object({ error: z.string() }).safeParse(raw)
    throw new ViewError(response.status, code.success ? code.data.error : "")
  }
  return response.json()
}
const ref = (v: ViewRef) => ({ board_id: v.boardId, dataset_id: v.datasetId, view_id: v.viewId })
export async function listViews(boardId: string, signal: AbortSignal) {
  const result = z.object({ views: z.array(view) }).parse(await request("views?" + new URLSearchParams({ board_id: boardId }), signal))
  if (result.views.some(v => v.boardId !== boardId)) throw new Error("View board mismatch")
  return result.views
}
export async function queryGrid(v: ViewRef | Recipient, signal: AbortSignal, cursor?: string) {
  const shared = "shareToken" in v
  const result = page.parse(await request(shared ? "views/query" : "views/owner-query", signal, {
    ...ref(v), page_size: 1, ...(shared ? { share_token: v.shareToken } : {}), ...(cursor ? { cursor } : {}),
  }))
  if (result.boardId !== v.boardId || result.datasetId !== v.datasetId || result.viewId !== v.viewId ||
      JSON.stringify(result.fields) !== JSON.stringify(result.columns.map(c => c.id)) ||
      result.rows.some(r => Object.keys(r.cells).some(id => !result.fields.includes(id)))) throw new Error("View projection mismatch")
  return result
}
export async function listShares(v: ViewRef, signal: AbortSignal) {
  return z.object({ shares: z.array(share) }).parse(await request("views/shares?" + new URLSearchParams(ref(v)), signal)).shares
}
export async function issueShare(v: ViewRef, signal: AbortSignal) {
  const result = share.omit({ revoked: true }).extend({ shareToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/), viewId: uuid })
    .parse(await request("views/share", signal, ref(v)))
  if (result.viewId !== v.viewId) throw new Error("Share view mismatch")
  return result
}
export async function revokeShare(v: ViewRef, s: ViewShare, signal: AbortSignal) {
  const result = share.parse(await request("views/revoke", signal, { ...ref(v), share_id: s.shareId, expected_version: s.shareVersion }))
  if (result.shareId !== s.shareId || !result.revoked || result.shareVersion !== s.shareVersion + 1) throw new Error("Share revoke mismatch")
  return result
}
export function sharedViewUrl(v: Recipient) {
  const parsed = recipient.parse(v)
  const url = new URL("/shared-view/" + parsed.boardId + "/" + parsed.datasetId + "/" + parsed.viewId, location.origin)
  url.hash = new URLSearchParams({ share: parsed.shareToken }).toString()
  return url.href
}
export function readRecipient(href: string): Recipient | null {
  const url = new URL(href, location.origin)
  const [, route, boardId, datasetId, viewId, ...extra] = url.pathname.split("/")
  if (route !== "shared-view" || extra.length) return null
  const parsed = recipient.safeParse({ boardId, datasetId, viewId, shareToken: new URLSearchParams(url.hash.slice(1)).get("share") })
  return parsed.success ? parsed.data : null
}
