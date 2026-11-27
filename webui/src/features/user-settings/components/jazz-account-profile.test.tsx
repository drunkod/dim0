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

it("resumes the same pending disconnect after settings refresh and a fresh mount", async () => {
  const grant = {
    id: "550e8400-e29b-41d4-a716-446655440002",
    clientId: "pending-client", boardId: "pending-board", grantVersion: 3,
    createdAtMs: 100, revokedAtMs: null,
  }
  const revocations: Array<Record<string, unknown>> = []
  let revoked = false
  const confirm = vi.fn(() => true)
  vi.stubGlobal("confirm", confirm)
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    const resource = url.split("/api/account/")[1]
    if (resource === "connected-apps") return Response.json({
      grants: [{ ...grant, revokedAtMs: revoked ? 200 : null,
        pendingDisconnect: !revoked && revocations[0] ? {
          requestId: revocations[0].request_id, expectedVersion: 3,
        } : null }],
      hasMore: false,
    })
    if (resource === "connected-apps/revoke" && options?.method === "POST") {
      const body = JSON.parse(String(options.body)) as Record<string, unknown>
      revocations.push(body)
      if (revocations.length === 1) return Response.json({
        error: "WRITE_DRAIN_PENDING", disconnected: false, retry_same_request: true,
      }, { status: 503 })
      if (JSON.stringify(body) !== JSON.stringify(revocations[0]))
        return Response.json({ error: "STALE_STATE" }, { status: 409 })
      revoked = true
      return Response.json({ grant_id: grant.id, version: 4, revoked_at_ms: 200 })
    }
    return Response.json(resource === "profile" ? profile : { events: [] })
  }))
  const mounted = render(<JazzAccountProfile />)
  fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }))
  await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/WRITE_DRAIN_PENDING|waiting.*write/i))
  expect(screen.getByRole("button", { name: /^Retry disconnect$/ })).toBeTruthy()
  fireEvent.click(screen.getByRole("button", { name: "Refresh connected apps" }))
  await waitFor(() => expect((screen.getByRole("button", { name: /^Retry disconnect$/ }) as HTMLButtonElement).disabled).toBe(false))
  mounted.unmount()
  render(<JazzAccountProfile />)
  fireEvent.click(await screen.findByRole("button", { name: /^(Retry disconnect|Disconnect)$/ }))
  await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/grant revoked/i))
  expect(revocations).toHaveLength(2)
  expect(revocations[1]).toEqual(revocations[0])
  expect(confirm).toHaveBeenCalledTimes(1)
})


it.each([408, 429])("retains an uncertain disconnect through HTTP %s and keeps another grant independent", async transientStatus => {
  const grants = [
    { id: "550e8400-e29b-41d4-a716-446655440003", clientId: "lost-response-client",
      boardId: "board-a", grantVersion: 2, createdAtMs: 100, revokedAtMs: null as number | null },
    { id: "550e8400-e29b-41d4-a716-446655440004", clientId: "independent-client",
      boardId: "board-b", grantVersion: 7, createdAtMs: 100, revokedAtMs: null as number | null },
  ]
  const revocations: Array<Record<string, unknown>> = []
  vi.stubGlobal("confirm", vi.fn(() => true))
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    const resource = url.split("/api/account/")[1]
    if (resource === "connected-apps") return Response.json({ grants, hasMore: false })
    if (resource === "connected-apps/revoke" && options?.method === "POST") {
      const body = JSON.parse(String(options.body)) as Record<string, unknown>
      revocations.push(body)
      if (revocations.length === 1) throw new TypeError("Failed to fetch")
      if (revocations.length === 2)
        return Response.json({ error: "TRANSIENT_FAILURE" }, { status: transientStatus })
      if (body.grant_id === grants[0].id && JSON.stringify(body) !== JSON.stringify(revocations[0]))
        return Response.json({ error: "STALE_STATE" }, { status: 409 })
      const grant = grants.find(candidate => candidate.id === body.grant_id)!
      grant.revokedAtMs = 200
      return Response.json({ grant_id: grant.id, version: grant.grantVersion + 1, revoked_at_ms: 200 })
    }
    return Response.json(resource === "profile" ? profile : { events: [] })
  }))
  render(<JazzAccountProfile />)
  await screen.findByText(/Client lost-response-client/)
  fireEvent.click(screen.getAllByRole("button", { name: "Disconnect" })[0])
  await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/Failed to fetch|could not be confirmed/i))
  fireEvent.click(screen.getAllByRole("button", { name: /^(Retry disconnect|Disconnect)$/ })[0])
  await waitFor(() => expect(revocations).toHaveLength(2))
  await waitFor(() => expect((screen.getAllByRole("button", { name: /^(Retry disconnect|Disconnect)$/ })[0] as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getAllByRole("button", { name: /^(Retry disconnect|Disconnect)$/ })[0])
  await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/grant revoked/i))
  expect(revocations[1]).toEqual(revocations[0])
  expect(revocations[2]).toEqual(revocations[0])
  fireEvent.click(screen.getByRole("button", { name: "Disconnect" }))
  await waitFor(() => expect(revocations).toHaveLength(4))
  expect(revocations[3]).toMatchObject({
    grant_id: grants[1].id, client_id: grants[1].clientId, expected_version: 7,
  })
  expect(revocations[3].request_id).not.toBe(revocations[0].request_id)
})


it("uses a fresh intent after a definitive conflict and authoritative grant refresh", async () => {
  const grant = {
    id: "550e8400-e29b-41d4-a716-446655440005", clientId: "stale-client",
    boardId: "board-c", grantVersion: 3, createdAtMs: 100, revokedAtMs: null as number | null,
  }
  const revocations: Array<Record<string, unknown>> = []
  vi.stubGlobal("confirm", vi.fn(() => true))
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    const resource = url.split("/api/account/")[1]
    if (resource === "connected-apps") return Response.json({ grants: [grant], hasMore: false })
    if (resource === "connected-apps/revoke" && options?.method === "POST") {
      revocations.push(JSON.parse(String(options.body)) as Record<string, unknown>)
      if (revocations.length === 1) {
        grant.grantVersion = 4
        return Response.json({ error: "STALE_STATE" }, { status: 409 })
      }
      grant.revokedAtMs = 200
      return Response.json({ grant_id: grant.id, version: 5, revoked_at_ms: 200 })
    }
    return Response.json(resource === "profile" ? profile : { events: [] })
  }))
  render(<JazzAccountProfile />)
  fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }))
  await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/STALE_STATE/))
  fireEvent.click(screen.getByRole("button", { name: "Refresh connected apps" }))
  await waitFor(() => expect((screen.getByRole("button", { name: "Disconnect" }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByRole("button", { name: "Disconnect" }))
  await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/grant revoked/i))
  expect(revocations.map(body => body.expected_version)).toEqual([3, 4])
  expect(revocations[1].request_id).not.toBe(revocations[0].request_id)
})

it("switches language only after the saved locale response and switches back", async () => {
  const { clearAccountLocale } = await import("@/i18n")
  clearAccountLocale()
  try {
    let version = 0
    const requests: Record<string, unknown>[] = []
    vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith("/preferences") && options?.method === "PATCH") {
        const input = JSON.parse(String(options.body))
        requests.push(input)
        return Response.json({ locale: input.locale, version: ++version, changed: true })
      }
      if (url.endsWith("/connected-apps")) return Response.json({ grants: [], hasMore: false })
      return Response.json(url.endsWith("/profile") ? profile : { events: [] })
    }))
    render(<JazzAccountProfile />)
    fireEvent.change(await screen.findByRole("combobox", { name: "Interface language" }), { target: { value: "ru" } })
    expect(screen.getByRole("button", { name: "Save locale preference" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Save locale preference" }))
    await screen.findByText("Язык сохранён.")
    expect(document.documentElement.lang).toBe("ru")
    expect(requests[0]).toMatchObject({ locale: "ru-RU", expected_version: 0 })
    fireEvent.change(screen.getByRole("combobox", { name: "Язык интерфейса" }), { target: { value: "en" } })
    fireEvent.click(screen.getByRole("button", { name: "Сохранить язык" }))
    await screen.findByText("Locale preference saved.")
    expect(document.documentElement.lang).toBe("en")
    expect(requests[1]).toMatchObject({ locale: "en", expected_version: 1 })
  } finally { cleanup(); clearAccountLocale() }
})
