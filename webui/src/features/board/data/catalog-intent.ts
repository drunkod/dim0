import { z } from "zod"

const uuid = z.string().uuid()
const requestId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)
const name = z.string().min(1).max(80)
const table = z.object({
  board_id: uuid, request_id: requestId, name,
  primary_field_name: name, default_view_name: name,
}).strict()
const row = z.object({
  board_id: uuid, dataset_id: uuid, field_id: uuid,
  schema_version: z.number().int().positive(), request_id: requestId, value: z.string().max(2000),
}).strict()
const view = z.object({
  board_id: uuid, dataset_id: uuid,
  definition: z.object({
    name, allowed_field_ids: z.array(uuid).min(1).max(20),
    filter: z.object({ op: z.literal("text_prefix"), field_id: uuid, value: z.string().max(80) }).strict(),
    sort: z.object({ field_id: uuid, direction: z.literal("asc") }).strict(),
  }).strict(),
}).strict()

const intentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("table"), input: table }).strict(),
  z.object({ kind: z.literal("row"), input: row, viewId: uuid }).strict(),
  z.object({ kind: z.literal("view-review"), input: view, viewId: uuid, reviewId: uuid }).strict(),
])
export type CatalogIntent = z.infer<typeof intentSchema>
export type CatalogIntentScope = Readonly<{ subjectId: string; accountId: string; boardId: string }>
type IntentStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">

// Origin + browser tab are implicit in sessionStorage. The verified account and
// board are explicit. No auth token, share credential or server principal override.
function key(scope: CatalogIntentScope) {
  return "dim0:catalog-intent:v1:" + [scope.subjectId, scope.accountId, scope.boardId].map(encodeURIComponent).join(":")
}
function validated(scope: CatalogIntentScope, value: unknown): CatalogIntent {
  const intent = intentSchema.parse(value)
  if (intent.input.board_id !== scope.boardId) throw new Error("Catalog intent scope mismatch")
  return intent
}
const identical = (a: CatalogIntent, b: CatalogIntent) => JSON.stringify(a) === JSON.stringify(b)

// Invalid or inaccessible storage must never masquerade as an empty journal.
export function readCatalogIntent(scope: CatalogIntentScope, storage: IntentStorage = sessionStorage): CatalogIntent | null {
  const raw = storage.getItem(key(scope))
  return raw === null ? null : validated(scope, JSON.parse(raw))
}

/** Synchronous, before the first HTTP dispatch; retry must match the saved intent. */
export function retainCatalogIntent(scope: CatalogIntentScope, action: CatalogIntent, retry: boolean, storage: IntentStorage = sessionStorage) {
  const next = validated(scope, action)
  const prior = readCatalogIntent(scope, storage)
  if (retry ? !prior || !identical(prior, next) : prior !== null) throw new Error("Catalog intent already pending or changed")
  storage.setItem(key(scope), JSON.stringify(next))
}

/** Do not let a stale completion clear a newer or different intent. */
export function releaseCatalogIntent(scope: CatalogIntentScope, action: CatalogIntent, storage: IntentStorage = sessionStorage) {
  const prior = readCatalogIntent(scope, storage)
  if (!prior || !identical(prior, validated(scope, action))) throw new Error("Catalog intent changed")
  storage.removeItem(key(scope))
}
