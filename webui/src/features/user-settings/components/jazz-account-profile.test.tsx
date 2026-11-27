import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"

import { JazzAccountProfile } from "./jazz-account-profile"

const profile = { display_name: "Alice", locale: "en", version: 0,
  email_required: false, backup_passkey_enrollment_available: false }
const grant = { id: "550e8400-e29b-41d4-a716-446655440000", clientId: "client-a",
  boardId: "board-a", grantVersion: 3, createdAtMs: 100, revokedAtMs: null }
const independent = { ...grant, id: "550e8400-e29b-41d4-a716-446655440001", clientId: "client-b" }

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it("preserves a confirmed disconnection even if the subsequent grant list refresh fails", async () => {
  let reads = 0
  const posts: unknown[] = []
  vi.stubGlobal("confirm", vi.fn(() => true))
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith("/connected-apps/revoke")) {
      expect(options?.method).toBe("POST")
      posts.push(JSON.parse(String(options?.body)))
      return Response.json({ grant_id: grant.id, version: 4, revoked_at_ms: 200 })
    }
    if (url.endsWith("/connected-apps")) {
      reads++
      if (reads === 2) return Response.json({ error: "GRANTS_UNAVAILABLE" }, { status: 503 })
      return Response.json({ grants: [reads === 1 ? grant : { ...grant, grantVersion: 4, revokedAtMs: 200 }, independent], hasMore: false })
    }
    return Response.json(url.endsWith("/profile") ? profile : { events: [] })
  }))
  render(<JazzAccountProfile />)
  await screen.findByText("Client client-a")
  const row = screen.getByText("Client client-a").closest("li")!
  fireEvent.click(row.querySelector("button")!)
  await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/grant revoked.*list temporarily unavailable/i))
  expect(screen.getByText(/Connected apps unavailable/i)).toBeTruthy()
  expect(posts).toEqual([expect.objectContaining({ grant_id: grant.id, client_id: grant.clientId, expected_version: 3, request_id: expect.any(String) })])
  fireEvent.click(screen.getByRole("button", { name: "Refresh connected apps" }))
  await screen.findByRole("button", { name: "Disconnected" })
  expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy()
  expect(posts).toHaveLength(1)
})

it("does not report disconnection for an unconfirmed mutation", async () => {
  vi.stubGlobal("confirm", vi.fn(() => true))
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.endsWith("/connected-apps/revoke")) return Response.json({ error: "STALE_STATE" }, { status: 409 })
    if (url.endsWith("/connected-apps")) return Response.json({ grants: [grant], hasMore: false })
    return Response.json(url.endsWith("/profile") ? profile : { events: [] })
  }))
  render(<JazzAccountProfile />)
  fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }))
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("STALE_STATE"))
  expect(screen.queryByRole("button", { name: "Disconnected" })).toBeNull()
})

it("keeps profile editing available if the optional grant list fails to load", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.endsWith("/connected-apps")) return Response.json({ error: "GRANTS_UNAVAILABLE" }, { status: 503 })
    return Response.json(url.endsWith("/profile") ? profile : { events: [] })
  }))
  render(<JazzAccountProfile />)
  expect(await screen.findByDisplayValue("Alice")).toBeTruthy()
  expect(await screen.findByText(/Connected apps unavailable/i)).toBeTruthy()
})
