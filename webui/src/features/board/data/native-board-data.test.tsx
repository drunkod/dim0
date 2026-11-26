import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { NativeBoardData } from "./native-board-data"
import { createTable, addRow, saveView } from "./catalog-api"
import { listViews, type OwnerView } from "./saved-view-api"

vi.mock("./catalog-api", async original => ({
  ...await original<typeof import("./catalog-api")>(),
  createTable: vi.fn(), addRow: vi.fn(), saveView: vi.fn(),
}))
vi.mock("./saved-view-api", async original => ({
  ...await original<typeof import("./saved-view-api")>(),
  listViews: vi.fn(),
}))
vi.mock("./saved-view-grid", () => ({ SavedViewGrid: ({ view }: { view: OwnerView }) => <div role="region" aria-label={"Grid " + view.name}>Grid</div> }))
const list = vi.mocked(listViews)
const table = vi.mocked(createTable)
const row = vi.mocked(addRow)
const save = vi.mocked(saveView)
const view: OwnerView = { boardId: "board", datasetId: "dataset", viewId: "all", viewVersion: 1, name: "All rows", datasetName: "Rehearsal",
  datasetSchemaVersion: 1, singleTextTable: true, fields: [{ id: "field", name: "Title" }] }
const created = { boardId: "board", datasetId: "dataset", fieldId: "field", defaultViewId: "all", schemaVersion: 1,
  receiptId: "receipt", eventId: "event", replayed: true }
beforeEach(() => { list.mockReset(); table.mockReset(); row.mockReset(); save.mockReset() })
afterEach(cleanup)
async function open() {
  render(<NativeBoardData boardId="board" />)
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
  expect(table.mock.calls[0][0]).toMatchObject({ board_id: "board", name: "Rehearsal", primary_field_name: "Title", default_view_name: "All rows" })
  const allRows = await screen.findByRole("button", { name: "Open saved view All rows" })
  expect(allRows.getAttribute("aria-pressed")).toBe("true")
  await screen.findByRole("region", { name: "Grid All rows" })
  expect(table).toHaveBeenCalledTimes(2)
})
test("lost row reply retries same value and ID, then saves a filtered view", async () => {
  list.mockResolvedValue([view])
  row.mockRejectedValueOnce(new Error("lost reply")).mockResolvedValueOnce({
    datasetId: "dataset", fieldId: "field", recordId: "row", updatedBy: "owner", schemaVersion: 1, version: 1, receiptId: "r", eventId: "e", replayed: true,
  })
  save.mockResolvedValue({ boardId: "board", datasetId: "dataset", viewId: "demo", viewVersion: 1, name: "Demo items" })
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
    name: "Demo items", allowed_field_ids: ["field"], filter: { op: "text_prefix", field_id: "field", value: "Demo" },
    sort: { field_id: "field", direction: "asc" },
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
