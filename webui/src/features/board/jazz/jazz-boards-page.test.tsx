import { render, screen } from "@testing-library/react"
import { it, expect, vi } from "vitest"
import { JazzBoardsPage } from "./jazz-boards-page"

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}))
vi.mock("./jazz-auth-client", () => ({
  currentJazzIdentity: async () => ({
    id: "subject-fixture", accountId: "actor-fixture", name: "Fixture Owner",
  }),
  readPendingJazzInvitation: () => null,
  clearPendingJazzInvitation: () => {},
  continueJazzOAuth: () => false,
}))
vi.mock("@/features/signin/components/jazz-logout-button", () => ({
  JazzLogoutButton: () => null,
}))

it("offers signed-in passkey users an Account settings link", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ boards: [] })))
  render(<JazzBoardsPage />)
  const link = await screen.findByRole("link", { name: "Account settings" })
  expect(link.getAttribute("href")).toBe("/settings")
})
