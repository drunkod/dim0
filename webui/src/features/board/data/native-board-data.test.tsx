import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { NativeBoardData } from "./native-board-data"
import { createTable, addRow, saveView } from "./catalog-api"
import { listViews, ViewError, type OwnerView } from "./saved-view-api"

import { currentJazzIdentity } from "../jazz/jazz-auth-client"
import { readCatalogIntent } from "./catalog-intent"

vi.mock("../jazz/jazz-auth-client", () => ({ currentJazzIdentity: vi.fn() }))
vi.mock("./catalog-api", async original => ({
  ...await original<typeof import("./catalog-api")>(),
  createTable: vi.fn(), addRow: vi.fn(), saveView: vi.fn(),
}))
vi.mock("./saved-view-api", async original => ({
  ...await original<typeof import("./saved-view-api")>(),
  listViews: vi.fn(),
}))
vi.mock("./saved-view-grid", () => ({ SavedViewGrid: ({ view }: { view: OwnerView }) => <div role="region" aria-label={"Grid " + view.name}>Grid</div> }))
const boardId = "11111111-1111-4111-8111-111111111111"
const datasetId = "22222222-2222-4222-8222-222222222222"
const fieldId = "33333333-3333-4333-8333-333333333333"
const viewId = "44444444-4444-4444-8444-444444444444"
const actorId = "55555555-5555-4555-8555-555555555555"
const identity = { id: "fixture-owner-subject", accountId: actorId, name: "Owner" }
const scope = { subjectId: identity.id, accountId: actorId, boardId }
const who = vi.mocked(currentJazzIdentity)
const list = vi.mocked(listViews)
const table = vi.mocked(createTable)
const row = vi.mocked(addRow)
const save = vi.mocked(saveView)
const view: OwnerView = { boardId: boardId, datasetId: datasetId, viewId: viewId, viewVersion: 1, name: "All rows", datasetName: "Rehearsal",
  datasetSchemaVersion: 1, singleTextTable: true, fields: [{ id: fieldId, name: "Title" }] }
const created = { boardId: boardId, datasetId: datasetId, fieldId: fieldId, defaultViewId: viewId, schemaVersion: 1,
  receiptId: "receipt", eventId: "event", replayed: true }
beforeEach(() => { sessionStorage.clear(); who.mockReset().mockResolvedValue(identity); list.mockReset(); table.mockReset(); row.mockReset(); save.mockReset() })
afterEach(() => { cleanup(); vi.restoreAllMocks(); sessionStorage.clear() })
async function open() {
  render(<NativeBoardData boardId={boardId} />)
  fireEvent.click(await screen.findByRole("button", { name: "Open board Data" }))
}
function fill(label: string, value: string) { fireEvent.change(screen.getByRole("textbox", { name: label }), { target: { value } }) }
function click(name: string) { fireEvent.click(screen.getByRole("button", { name })) }
test("lost table response freezes original definition and retries the identical request", async () => {
  let rejectFirst!: (reason: Error) => void
  list.mockResolvedValue([])
  table.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject }))
    .mockImplementationOnce(async () => {
      list.mockResolvedValue([view]); return created
    })
  await open()
  fill("Table name", "Rehearsal")
  click("Create table")
  const retry = await screen.findByRole("button", { name: "Retry Create table" }) as HTMLButtonElement
  // Reproduce the early click allowed by an existence-only wait.
  expect(retry.disabled).toBe(true)
  await act(async () => { fireEvent.click(retry) })
  expect(table).toHaveBeenCalledTimes(1)
  console.info("CATALOG_RETRY_EARLY_CLICK", { enabled: !retry.disabled, calls: table.mock.calls.length })
  await act(async () => { rejectFirst(new Error("lost reply")) })
  await screen.findByText(/Commit outcome unconfirmed/)
  await waitFor(() => expect(retry.disabled).toBe(false))
  expect((screen.getByRole("textbox", { name: "Table name" }) as HTMLInputElement).disabled).toBe(true)
  expect((screen.getByRole("button", { name: "Create table" }) as HTMLButtonElement).disabled).toBe(true)
  await act(async () => { fireEvent.click(retry) })
  await waitFor(() => expect(table).toHaveBeenCalledTimes(2))
  await expect(table.mock.results[1].value).resolves.toEqual(created)
  console.info("CATALOG_RETRY_ENABLED_CLICK", { enabledAtClick: true, calls: table.mock.calls.length, replayed: created.replayed })
  await screen.findByText("Table created.")
  expect(table.mock.calls[0][0]).toEqual(table.mock.calls[1][0])
  expect(table.mock.calls[0][0]).toMatchObject({ board_id: boardId, name: "Rehearsal", primary_field_name: "Title", default_view_name: "All rows" })
  const allRows = await screen.findByRole("button", { name: "Open saved view All rows" })
  expect(allRows.getAttribute("aria-pressed")).toBe("true")
  await screen.findByRole("region", { name: "Grid All rows" })
  expect(table).toHaveBeenCalledTimes(2)
})
test("lost row reply retries same value and ID, then saves a filtered view", async () => {
  list.mockResolvedValue([view])
  row.mockRejectedValueOnce(new Error("lost reply")).mockResolvedValueOnce({
    datasetId: datasetId, fieldId: fieldId, recordId: "row", updatedBy: actorId, schemaVersion: 1, version: 1, receiptId: "r", eventId: "e", replayed: true,
  })
  save.mockResolvedValue({ boardId: boardId, datasetId: datasetId, viewId: "demo", viewVersion: 1, name: "Demo items" })
  await open()
  click("Open saved view All rows")
  fill("New row Title", "Demo alpha")
  click("Add row")
  const retry = await screen.findByRole("button", { name: "Retry Add row" }) as HTMLButtonElement
  await waitFor(() => expect(retry.disabled).toBe(false))
  expect((screen.getByRole("textbox", { name: "New row Title" }) as HTMLInputElement).disabled).toBe(true)
  await act(async () => { fireEvent.click(retry) })
  await waitFor(() => expect(row).toHaveBeenCalledTimes(2))
  await screen.findByText("Row added.")
  expect(row.mock.calls[0][0]).toEqual(row.mock.calls[1][0])
  fill("Saved view name", "Demo items")
  fill("Title starts with", "Demo")
  click("Save view")
  await screen.findByText("View saved.")
  expect(save.mock.calls[0][0].definition).toEqual({
    name: "Demo items", allowed_field_ids: [fieldId], filter: { op: "text_prefix", field_id: fieldId, value: "Demo" },
    sort: { field_id: fieldId, direction: "asc" },
  })
})
test("an unsupported legacy view does not expose catalog row actions", async () => {
  list.mockResolvedValue([{ ...view, singleTextTable: false }])
  await open()
  click("Open saved view All rows")
  expect(screen.queryByRole("button", { name: "Add row" })).toBeNull()
  expect(screen.queryByRole("button", { name: "Save view" })).toBeNull()
})
test("a second submit while a table command is in flight cannot allocate another ID", async () => {
  let release!: (value: typeof created) => void
  list.mockResolvedValue([])
  table.mockImplementation(() => new Promise(resolve => { release = resolve }))
  await open()
  fill("Table name", "Rehearsal")
  click("Create table")
  await waitFor(() => expect(table).toHaveBeenCalledTimes(1))
  fireEvent.submit(screen.getByRole("form", { name: "Create text table" }))
  expect(table).toHaveBeenCalledTimes(1)
  await act(async () => release(created))
})

test("isolated external catalog readback does not expose browser mutation controls", async () => {
  list.mockResolvedValue([view])
  render(<NativeBoardData boardId={boardId} readOnly />)
  fireEvent.click(await screen.findByRole("button", { name: "Open board Data" }))
  click("Open saved view All rows")
  await screen.findByRole("region", { name: "Grid All rows" })
  expect(screen.queryByRole("button", { name: "Create table" })).toBeNull()
  expect(screen.queryByRole("button", { name: "Add row" })).toBeNull()
  expect(screen.queryByRole("button", { name: "Save view" })).toBeNull()
  expect(table).not.toHaveBeenCalled()
  expect(row).not.toHaveBeenCalled()
  expect(save).not.toHaveBeenCalled()
})

test("persistent Owner catalog exposes table and row actions but not saved-view creation", async () => {
  list.mockResolvedValue([view])
  render(<NativeBoardData boardId={boardId} allowSaveView={false} />)
  fireEvent.click(await screen.findByRole("button", { name: "Open board Data" }))
  click("Open saved view All rows")
  await screen.findByRole("region", { name: "Grid All rows" })
  expect(screen.getByRole("button", { name: "Create table" })).toBeTruthy()
  expect(screen.getByRole("button", { name: "Add row" })).toBeTruthy()
  expect(screen.queryByRole("button", { name: "Save view" })).toBeNull()
  expect(save).not.toHaveBeenCalled()
})

const rowResult = { datasetId, fieldId, recordId: "row", updatedBy: actorId, schemaVersion: 1, version: 1, receiptId: "r", eventId: "e", replayed: true }

test("reload restores the frozen row and retries exactly the same input", async () => {
  list.mockResolvedValue([view])
  row.mockRejectedValueOnce(new Error("lost reply")).mockResolvedValueOnce(rowResult)
  await open()
  click("Open saved view All rows")
  fill("New row Title", "Reload survives")
  click("Add row")
  await screen.findByText(/Commit outcome unconfirmed/)
  const original = row.mock.calls[0][0]
  expect(readCatalogIntent(scope)).toEqual({ kind: "row", viewId, input: original })
  cleanup()
  await open()
  await screen.findByText(/Commit outcome unconfirmed/)
  expect(row).toHaveBeenCalledTimes(1)
  expect((screen.getByRole("textbox", { name: "New row Title" }) as HTMLInputElement).value).toBe("Reload survives")
  expect((screen.getByRole("button", { name: /^Add row$/ }) as HTMLButtonElement).disabled).toBe(true)
  await act(async () => { click("Retry Add row") })
  await screen.findByText("Row added.")
  expect(row).toHaveBeenCalledTimes(2)
  expect(row.mock.calls[1][0]).toEqual(original)
  expect(readCatalogIntent(scope)).toBeNull()
})

test("reload while the first table request is still in flight retains the exact definition", async () => {
  list.mockResolvedValue([])
  table.mockImplementationOnce(() => new Promise(() => {})).mockImplementationOnce(async () => {
    list.mockResolvedValue([view]); return created
  })
  await open()
  fill("Table name", "Rehearsal")
  click("Create table")
  await waitFor(() => expect(table).toHaveBeenCalledTimes(1))
  const original = table.mock.calls[0][0]
  expect(readCatalogIntent(scope)).toEqual({ kind: "table", input: original })
  cleanup()
  await open()
  await screen.findByText(/Commit outcome unconfirmed/)
  expect((screen.getByRole("textbox", { name: "Table name" }) as HTMLInputElement).value).toBe("Rehearsal")
  await act(async () => { click("Retry Create table") })
  await screen.findByText("Table created.")
  expect(table).toHaveBeenCalledTimes(2)
  expect(table.mock.calls[1][0]).toEqual(original)
  expect(readCatalogIntent(scope)).toBeNull()
})

test("a rejected retry does not erase the earlier uncertain row", async () => {
  list.mockResolvedValue([view])
  row.mockRejectedValueOnce(new Error("lost reply")).mockRejectedValueOnce(new ViewError(409, "TYPED_REQUEST_ID_CONFLICT"))
  await open()
  click("Open saved view All rows")
  fill("New row Title", "Uncertain")
  click("Add row")
  await screen.findByText(/Commit outcome unconfirmed/)
  const original = readCatalogIntent(scope)
  await act(async () => { click("Retry Add row") })
  await screen.findByText(/Retry did not confirm the original outcome/)
  expect(readCatalogIntent(scope)).toEqual(original)
  expect((screen.getByRole("button", { name: /^Add row$/ }) as HTMLButtonElement).disabled).toBe(true)
})

test("a changed authenticated account cannot submit the frozen intent", async () => {
  list.mockResolvedValue([view])
  row.mockRejectedValueOnce(new Error("lost reply"))
  await open()
  click("Open saved view All rows")
  fill("New row Title", "Original account")
  click("Add row")
  await screen.findByText(/Commit outcome unconfirmed/)
  const original = readCatalogIntent(scope)
  who.mockResolvedValue({ ...identity, id: "different-subject", accountId: "66666666-6666-4666-8666-666666666666" })
  await act(async () => { click("Retry Add row") })
  await screen.findByText(/Account changed/)
  expect(row).toHaveBeenCalledTimes(1)
  expect(readCatalogIntent(scope)).toEqual(original)
})

test("unknown saved view remains locked through failed refresh and remount until explicit review", async () => {
  list.mockResolvedValue([view])
  save.mockRejectedValueOnce(new Error("lost reply"))
  await open()
  click("Open saved view All rows")
  fill("Saved view name", "Demo items")
  fill("Title starts with", "Demo")
  click("Save view")
  await screen.findByText(/Save view outcome unconfirmed/)
  expect(readCatalogIntent(scope)?.kind).toBe("view-review")
  cleanup()
  await open()
  await screen.findByText(/Save view outcome unconfirmed/)
  list.mockRejectedValue(new Error("offline"))
  click("Refresh and review saved views")
  await screen.findByRole("button", { name: "Retry Data" })
  expect(screen.queryByRole("button", { name: "I reviewed the saved views" })).toBeNull()
  expect(readCatalogIntent(scope)?.kind).toBe("view-review")
  list.mockResolvedValue([view])
  click("Retry Data")
  fireEvent.click(await screen.findByRole("button", { name: "Open board Data" }))
  expect((await screen.findByRole("button", { name: /^Save view$/ }) as HTMLButtonElement).disabled).toBe(true)
  click("Refresh and review saved views")
  await screen.findByRole("button", { name: "I reviewed the saved views" })
  expect((screen.getByRole("button", { name: /^Save view$/ }) as HTMLButtonElement).disabled).toBe(true)
  await act(async () => { click("I reviewed the saved views") })
  await screen.findByText("View list reviewed. No save request was replayed.")
  expect(readCatalogIntent(scope)).toBeNull()
  expect(save).toHaveBeenCalledTimes(1)
})

test("corrupt retry storage blocks new writes rather than treating it as empty", async () => {
  const k = "dim0:catalog-intent:v1:" + [scope.subjectId, scope.accountId, scope.boardId].map(encodeURIComponent).join(":")
  sessionStorage.setItem(k, "{")
  list.mockResolvedValue([view])
  await open()
  await screen.findByText(/Browser retry storage is unavailable or changed/)
  expect((screen.getByRole("button", { name: "Create table" }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.submit(screen.getByRole("form", { name: "Create text table" }))
  expect(table).not.toHaveBeenCalled()
  expect(sessionStorage.getItem(k)).toBe("{")
})
