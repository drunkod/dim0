import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { SavedViewGrid } from "./saved-view-grid"
import { queryGrid, ViewError, type ViewPage } from "./saved-view-api"
vi.mock("./saved-view-api", async original => ({
  ...await original<typeof import("./saved-view-api")>(),
  queryGrid: vi.fn(),
}))
const query = vi.mocked(queryGrid)
const view = { boardId: "a", datasetId: "b", viewId: "c", shareToken: "fixture" }
const page = (title: string, nextCursor: string | null, version = 1): ViewPage => ({
  ...view, viewVersion: version, name: "Demo items", columns: [{ id: "title", name: "Title" }], fields: ["title"],
  rows: [{ id: "record", version: 7, cells: { title } }], total: 2, nextCursor,
})
beforeEach(() => query.mockReset())
afterEach(cleanup)

test("late successful request cannot repaint after newer revocation denial", async () => {
  let release!: (result: ViewPage) => void
  query.mockResolvedValueOnce(page("Demo alpha", "cursor"))
    .mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    .mockRejectedValueOnce(new ViewError(403, "VIEW_ACCESS_DENIED"))
  render(<SavedViewGrid view={view} />)
  await screen.findByText("Demo alpha")
  fireEvent.click(screen.getByRole("button", { name: "Next page" }))
  await waitFor(() => expect(query).toHaveBeenCalledTimes(2))
  expect(screen.queryByText("Demo alpha")).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "Refresh view" }))
  await screen.findByRole("alert")
  expect(screen.getByRole("alert").textContent).toMatch(/revoked/)
  await act(async () => release(page("Demo beta", null)))
  expect(screen.queryByRole("table")).toBeNull()
  expect(screen.queryByText(/matching records/)).toBeNull()
  expect((screen.getByRole("button", { name: "Next page" }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.queryByText("Demo beta")).toBeNull()
})

test("stale continuation clears page and fetches fresh first page", async () => {
  query.mockResolvedValueOnce(page("Demo alpha", "cursor"))
    .mockResolvedValueOnce(page("Demo beta", null))
    .mockRejectedValueOnce(new ViewError(409, "VIEW_CURSOR_REQUIRES_FRESH_QUERY"))
    .mockResolvedValueOnce(page("Revised first", "new", 2))
  render(<SavedViewGrid view={view} />)
  await screen.findByText("Demo alpha")
  fireEvent.click(screen.getByRole("button", { name: "Next page" }))
  await screen.findByText("Demo beta")
  fireEvent.click(screen.getByRole("button", { name: "Refresh view" }))
  await screen.findByText("Revised first")
  expect(screen.queryByText("Demo beta")).toBeNull()
  expect(screen.getByText(/Showing a fresh first page/)).toBeTruthy()
  expect(query.mock.calls[2][2]).toBe("cursor")
  expect(query.mock.calls[3][2]).toBeUndefined()
})

test("limit rejection removes existing rows and count", async () => {
  query.mockResolvedValueOnce(page("Demo alpha", "cursor"))
    .mockRejectedValueOnce(new ViewError(400, "VIEW_DATASET_LIMIT_500"))
  render(<SavedViewGrid view={view} />)
  await screen.findByText("Demo alpha")
  fireEvent.click(screen.getByRole("button", { name: "Refresh view" }))
  expect((await screen.findByRole("alert")).textContent).toMatch(/500-record QA limit/)
  expect(screen.queryByRole("table")).toBeNull()
  expect(screen.queryByText(/matching records/)).toBeNull()
})
