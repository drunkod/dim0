import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"
import { applyAccountLocale, clearAccountLocale, localeSessionEpoch, refreshAccountLocale, supportedLanguage, translateCopy, useCopy } from "./index"

afterEach(() => {
  cleanup()
  clearAccountLocale()
  vi.unstubAllGlobals()
})

test("supported regional tags and explicit English fallback; no recursive name translation", () => {
  expect(supportedLanguage("ru-RU")).toBe("ru")
  expect(supportedLanguage("en-GB")).toBe("en")
  expect(supportedLanguage("fr-FR")).toBeUndefined()
  expect(supportedLanguage("ru_RU")).toBeUndefined()
  expect(translateCopy("ru", "Open saved view {{name}}", { name: "Data" })).toBe("Открыть сохранённое представление Data")
  expect(translateCopy("ru", "board:write")).toBe("board:write")
  expect(translateCopy("en", "Board Data")).toBe("Board Data")
})
test("confirmed locale rerenders controls, with fallback and reset", () => {
  function Control() {
    const { t } = useCopy()
    return <button>{t("Board Data")}</button>
  }
  render(<Control />)
  expect(screen.getByRole("button", { name: "Board Data" })).toBeTruthy()
  act(() => applyAccountLocale("ru-RU", 1, localeSessionEpoch()))
  expect(screen.getByRole("button", { name: "Данные доски" })).toBeTruthy()
  expect(document.documentElement.lang).toBe("ru")
  act(() => applyAccountLocale("fr-FR", 2, localeSessionEpoch()))
  expect(screen.getByRole("button", { name: "Board Data" })).toBeTruthy()
  expect(document.documentElement.lang).toBe("en")
})
test("late read cannot overwrite a confirmed save or the next session", async () => {
  let respond!: (r: Response) => void
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { respond = resolve })))
  const pending = refreshAccountLocale()
  applyAccountLocale("ru-RU", 2, localeSessionEpoch())
  respond(Response.json({ locale: "en", version: 1 }))
  await pending
  expect(document.documentElement.lang).toBe("ru")
  const epoch = localeSessionEpoch()
  const stale = refreshAccountLocale()
  clearAccountLocale()
  respond(Response.json({ locale: "ru-RU", version: 5 }))
  await stale
  applyAccountLocale("ru-RU", 6, epoch)
  expect(document.documentElement.lang).toBe("en")
})
test("authenticated read restores saved locale and unauthorized read clears it", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ locale: "ru-RU", version: 2 }))
    .mockResolvedValueOnce(new Response(null, { status: 401 }))
  vi.stubGlobal("fetch", fetch)
  await refreshAccountLocale()
  expect(document.documentElement.lang).toBe("ru")
  await refreshAccountLocale()
  expect(document.documentElement.lang).toBe("en")
})
