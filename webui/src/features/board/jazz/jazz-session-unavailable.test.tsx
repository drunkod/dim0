import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { JazzSessionCheckError, JazzSessionUnavailable } from "./jazz-session-unavailable"

const router = vi.hoisted(() => ({ invalidate: vi.fn() }))
vi.mock("@tanstack/react-router", async (original) => ({
  ...await original<typeof import("@tanstack/react-router")>(),
  useRouter: () => router,
}))

afterEach(() => {
  cleanup()
  router.invalidate.mockClear()
})

it("offers a retry without losing the protected board destination", () => {
  render(<JazzSessionUnavailable error={new JazzSessionCheckError()} reset={() => {}} />)
  expect(screen.getByRole("alert").textContent).toMatch(/destination is preserved/i)
  expect(screen.getByRole("link", { name: "Local boards" }).getAttribute("href")).toBe("/local")
  fireEvent.click(screen.getByRole("button", { name: "Retry connection" }))
  expect(router.invalidate).toHaveBeenCalledTimes(1)
})

it("also provides a recovery path for an unexpected board-loader failure", () => {
  render(<JazzSessionUnavailable error={new Error("temporary failure")} reset={() => {}} />)
  expect(screen.getByRole("heading", { name: /temporarily unavailable/i })).toBeTruthy()
  fireEvent.click(screen.getByRole("button", { name: "Retry connection" }))
  expect(router.invalidate).toHaveBeenCalledTimes(1)
})
