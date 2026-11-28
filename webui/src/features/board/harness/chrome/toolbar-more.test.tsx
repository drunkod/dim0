import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { applyAccountLocale, clearAccountLocale, localeSessionEpoch } from "@/i18n"
import { HarnessToolbarMore } from "./toolbar-more"

const state = vi.hoisted(() => ({
  boardId: "test-board",
  chromeDialog: null,
  setTool: vi.fn(),
  setChromeDialog: vi.fn(),
  pick: vi.fn(),
  canParse: false,
}))
vi.mock("@canvas-harness/react", () => ({ useCanvasStore: () => ({}) }))
vi.mock("../canvas/use-node-type-count", () => ({ useNodeTypeCount: () => 2 }))
vi.mock("../store/board-app-store", () => ({
  useBoardAppStore: (select: (s: typeof state) => unknown) => select(state),
}))
vi.mock("@/store", () => ({ useAppStore: (select: (s: { userPlan: string }) => unknown) => select({ userPlan: "free" }) }))
vi.mock("@/features/board/lib/board-limit", () => ({ nodeLimitFor: () => 10 }))
vi.mock("@/features/agent/local/use-local-doc-upload", () => ({
  useLocalDocUpload: () => ({ canParse: state.canParse, busy: false, pick: state.pick, elements: null }),
}))
vi.mock("./document-upload-dialog", () => ({ DocumentUploadDialog: () => null }))
vi.mock("./icon-search-dialog", () => ({ IconSearchDialog: () => null }))
vi.mock("./image-search-dialog", () => ({ ImageSearchDialog: () => null }))

const en = ["Icons", "Images", "Sub-board", "Document", "Code sandbox", "Applet"]
const ru = ["Значки", "Изображения", "Вложенная доска", "Документ", "Песочница кода", "Апплет"]
const reasonEn = "Sign in or add a Mistral key to upload documents"
const reasonRu = "Войдите в аккаунт или добавьте ключ Mistral, чтобы загружать документы"
const itemNames = () => within(screen.getByRole("menu")).getAllByRole("menuitem")
  .map(item => item.querySelector("span")?.textContent)
const open = (name: string) => {
  const button = screen.getByRole("button", { name })
  fireEvent.keyDown(button, { key: "Enter" })
  return button
}

beforeEach(() => {
  clearAccountLocale()
  state.canParse = false
  vi.clearAllMocks()
})
afterEach(() => {
  cleanup()
  clearAccountLocale()
})

test("mounted menu and accessible trigger follow the confirmed locale, with English fallback", () => {
  render(<HarnessToolbarMore />)
  const button = open("More actions")
  expect(itemNames()).toEqual(en)
  expect(within(screen.getByRole("menu")).getByText("G")).toBeTruthy()
  expect(within(screen.getByRole("menu")).getByText("I")).toBeTruthy()
  expect(within(screen.getByRole("menu")).getAllByText("2/10")).toHaveLength(4)
  act(() => applyAccountLocale("ru-RU", 1, localeSessionEpoch()))
  expect(itemNames()).toEqual(ru)
  expect(button.getAttribute("aria-label")).toBe("Другие действия")
  act(() => applyAccountLocale("en", 2, localeSessionEpoch()))
  expect(itemNames()).toEqual(en)
  expect(button.getAttribute("aria-label")).toBe("More actions")
})

test("local upload remains disabled and its explanation follows the locale", () => {
  render(<HarnessToolbarMore local />)
  open("More actions")
  const document = screen.getByRole("menuitem", { name: /Document/ })
  expect(document.getAttribute("aria-disabled")).toBe("true")
  expect(document.getAttribute("title")).toBe(reasonEn)
  act(() => applyAccountLocale("ru", 1, localeSessionEpoch()))
  const localized = screen.getByRole("menuitem", { name: /Документ/ })
  expect(localized).toBe(document)
  expect(localized.getAttribute("aria-disabled")).toBe("true")
  expect(localized.getAttribute("title")).toBe(reasonRu)
  fireEvent.keyDown(localized, { key: "Enter" })
  expect(state.pick).not.toHaveBeenCalled()
  expect(state.setChromeDialog).not.toHaveBeenCalled()
})

test("keyboard selection retains the original action in Russian", () => {
  act(() => applyAccountLocale("ru", 1, localeSessionEpoch()))
  render(<HarnessToolbarMore />)
  open("Другие действия")
  fireEvent.keyDown(screen.getByRole("menuitem", { name: /Вложенная доска/ }), { key: "Enter" })
  expect(state.setTool).toHaveBeenCalledExactlyOnceWith("folder")
})

test("synced document action is still enabled without a local parser", () => {
  render(<HarnessToolbarMore />)
  open("More actions")
  const document = screen.getByRole("menuitem", { name: /Document/ })
  expect(document.hasAttribute("aria-disabled")).toBe(false)
  expect(document.hasAttribute("title")).toBe(false)
  fireEvent.keyDown(document, { key: "Enter" })
  expect(state.setChromeDialog).toHaveBeenCalledExactlyOnceWith("document-upload")
})
