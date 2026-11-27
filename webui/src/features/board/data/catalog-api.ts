import { z } from "zod"
import { request, ViewError } from "./saved-view-api"

const uuid = z.string().uuid()
const receipt = z.object({ receiptId: uuid, eventId: uuid, replayed: z.boolean() })
export type TableRequest = {
  board_id: string; request_id: string; name: string; primary_field_name: string; default_view_name: string
}
export type RowRequest = {
  board_id: string; dataset_id: string; field_id: string; schema_version: number; request_id: string; value: string
}
export type SaveViewRequest = {
  board_id: string; dataset_id: string
  definition: {
    name: string; allowed_field_ids: string[]
    filter: { op: "text_prefix"; field_id: string; value: string }
    sort: { field_id: string; direction: "asc" }
  }
}
export async function createTable(input: TableRequest, signal: AbortSignal) {
  const result = receipt.extend({ boardId: uuid, datasetId: uuid, fieldId: uuid, defaultViewId: uuid,
    schemaVersion: z.number().int().positive() }).parse(await request("tables/create", signal, input))
  if (result.boardId !== input.board_id) throw new Error("Catalog response mismatch")
  return result
}
export async function addRow(input: RowRequest, signal: AbortSignal) {
  const result = receipt.extend({ datasetId: uuid, fieldId: uuid, recordId: uuid, updatedBy: uuid,
    schemaVersion: z.number().int().positive(), version: z.number().int().positive() })
    .parse(await request("rows/create", signal, input))
  if (result.datasetId !== input.dataset_id || result.fieldId !== input.field_id ||
      result.schemaVersion !== input.schema_version) throw new Error("Row response mismatch")
  return result
}
export async function saveView(input: SaveViewRequest, signal: AbortSignal) {
  const result = z.object({ boardId: uuid, datasetId: uuid, viewId: uuid, viewVersion: z.number().int().positive(), name: z.string() })
    .parse(await request("views/create", signal, input))
  if (result.boardId !== input.board_id || result.datasetId !== input.dataset_id) throw new Error("Saved view mismatch")
  return result
}
/** Only a known definitive server rejection may release the frozen request.
 * Network errors, malformed success responses and 5xx retain the same ID. */
export function catalogRejection(error: unknown): string | null {
  if (!(error instanceof ViewError)) return null
  if ([401, 403, 404].includes(error.status)) return "Catalog access denied. Reopen Data after checking your account."
  if (error.status === 400) return "Invalid catalog definition or row value."
  if (error.status === 409) return error.code === "CATALOG_ROW_LIMIT_500"
    ? "This table has reached the 500-record QA limit." : "Catalog request conflicts with current data. Reopen Data before trying again."
  return null
}
