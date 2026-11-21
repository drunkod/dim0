import { chromium, expect } from "@playwright/test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"

const origin = "http://localhost:5178"
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const pageErrors = []
const consoleErrors = []
page.on("pageerror", error => pageErrors.push(error.message))
page.on("console", msg => { if (msg.type() === "error") consoleErrors.push(msg.text()) })
page.on("request", request => {
  if (request.url().includes("/api/canvas/create")) {
    const payload = request.postDataJSON()
    console.log("MVP_CANVAS_CREATE_REQUEST", JSON.stringify({
      board: payload?.board_id, kind: payload?.kind,
      id: payload?.payload?.id, graphUid: payload?.payload?.graphUid,
      type: payload?.payload?.type, length: request.postData()?.length,
    }))
  }
})
page.on("response", response => {
  if (response.url().includes("/api/canvas/create") && response.status() >= 400) {
    void response.text().then(text => console.log("MVP_CANVAS_CREATE_FAILED", response.status(), text))
  }
})

try {
  const cdp = await context.newCDPSession(page)
  await cdp.send("WebAuthn.enable")
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: {
    protocol: "ctap2", transport: "internal",
    hasResidentKey: true, hasUserVerification: true, isUserVerified: true,
    automaticPresenceSimulation: true,
  }})
  await page.goto(origin + "/patchboard-private/")
  await expect(page.getByRole("heading", { name: "Sign in to your private board" })).toBeVisible({ timeout: 20000 })
  await page.getByRole("button", { name: "Create account with passkey" }).click()
  await expect(page.getByRole("button", { name: /Sign out/ })).toBeVisible({ timeout: 20000 })
  const session = await page.evaluate(async () =>
    (await fetch("/patchboard-private/api/me", { credentials: "include" })).json()
  )
  assert.equal(session.signedIn, true)
  console.log("MVP_PRIVATE_PASSKEY_SESSION_PASS", session.accountId)

  await page.goto(origin + "/jazz-signin")
  await expect(page.getByRole("button", { name: "Create Jazz board" })).toBeVisible({ timeout: 20000 })
  await page.getByRole("button", { name: "Create Jazz board" }).click()
  await page.waitForURL(url => /^\/boards\/[0-9a-f-]{36}$/i.test(url.pathname), { timeout: 25000 })
  const boardId = new URL(page.url()).pathname.split("/").pop()
  console.log("MVP_JAZZ_BOARD_CREATED", boardId)

  const marker = "MVP-LIVE-" + randomUUID().slice(0, 8)
  const id = randomUUID()
  const payload = {
    id, type: "note", version: 1, graphUid: boardId,
    createdAt: new Date().toISOString(),
    label: { markdown: marker },
    content: { markdown: marker + " from an agent" },
    properties: {
      nodePosition: { type: "position", position: { x: 250, y: 210 } },
      nodeSize: { type: "size", size: { width: 350, height: 180 } },
      nodeZIndex: { type: "number", number: 1 },
    },
    style: { type: "rectangle" },
  }
  const created = await page.evaluate(async ({ boardId, payload }) => {
    const response = await fetch("/patchboard-private/api/canvas/create", {
      method: "POST", credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ board_id: boardId, kind: "node", payload }),
    })
    return { status: response.status, body: await response.json() }
  }, { boardId, payload })
  assert.equal(created.status, 201, JSON.stringify(created))
  console.log("MVP_AGENT_ENTITY_CREATED", id)
  await expect.poll(async () => page.evaluate(async board =>
    (await (await fetch("/patchboard-private/api/canvas?board_id=" + board, { credentials: "include" })).json()).entities.length,
  boardId), { timeout: 10000 }).toBe(1)
  // Exercise the actual Dim0 canvas input path, not merely direct API writes.
  await page.mouse.dblclick(820, 520)
  await page.mouse.click(1050, 630) // commit any inline editor
  await expect.poll(async () => page.evaluate(async board =>
    (await (await fetch("/patchboard-private/api/canvas?board_id=" + board, { credentials: "include" })).json()).entities.length,
  boardId), { timeout: 15000 }).toBe(2)
  console.log("MVP_HUMAN_CANVAS_EDIT_JAZZ_PERSISTED")
  // Independent session: invite a viewer and verify live Jazz snapshots arrive
  // in the SECOND real Dim0 canvas without a reload or shared browser cookies.
  const invite = await page.evaluate(async boardId => {
    const response = await fetch("/patchboard-private/api/invite", {
      method: "POST", credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ board_id: boardId, role: "viewer" }),
    })
    return { status: response.status, body: await response.json() }
  }, boardId)
  assert.equal(invite.status, 201, JSON.stringify(invite))
  const inviteToken = new URL(invite.body.invite_url).searchParams.get("invite")
  assert.ok(inviteToken)

  const viewerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await viewerContext.addInitScript(() => {
    const NativeEventSource = window.EventSource
    window.__jazzSnapshots = []
    window.EventSource = class extends NativeEventSource {
      constructor(url, options) {
        super(url, options)
        this.addEventListener("snapshot", (event) => {
          try { window.__jazzSnapshots.push(JSON.parse(event.data)) } catch {}
        })
      }
    }
  })
  const viewerPage = await viewerContext.newPage()
  viewerPage.on("pageerror", error => pageErrors.push("viewer: " + error.message))
  const viewerCdp = await viewerContext.newCDPSession(viewerPage)
  await viewerCdp.send("WebAuthn.enable")
  await viewerCdp.send("WebAuthn.addVirtualAuthenticator", { options: {
    protocol: "ctap2", transport: "internal",
    hasResidentKey: true, hasUserVerification: true,
    isUserVerified: true, automaticPresenceSimulation: true,
  }})
  await viewerPage.goto(origin + "/patchboard-private/")
  await viewerPage.getByRole("button", { name: "Create account with passkey" }).click()
  await expect(viewerPage.getByRole("button", { name: /Sign out/ })).toBeVisible({ timeout: 20000 })
  const joined = await viewerPage.evaluate(async ({ boardId, token }) => {
    const response = await fetch("/patchboard-private/api/join", {
      method: "POST", credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ board_id: boardId, token }),
    })
    return { status: response.status, body: await response.json() }
  }, { boardId, token: inviteToken })
  assert.equal(joined.status, 200, JSON.stringify(joined))
  await viewerPage.goto(origin + "/boards/" + boardId)
  await expect.poll(() => viewerPage.evaluate(id =>
    window.__jazzSnapshots?.some(s => s.entities?.some(e => e.id === id)),
  id), { timeout: 20000 }).toBe(true)
  console.log("MVP_TWO_BROWSER_INITIAL_CANVAS_PASS")

  const nextPayload = { ...payload, content: { markdown: marker + " LIVE UPDATED" } }
  const updated = await page.evaluate(async ({ boardId, id, nextPayload }) => {
    const response = await fetch("/patchboard-private/api/canvas/update", {
      method: "POST", credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ board_id: boardId, entity_id: id, expected_version: 1, payload: nextPayload }),
    })
    return { status: response.status, body: await response.json() }
  }, { boardId, id, nextPayload })
  assert.equal(updated.status, 200, JSON.stringify(updated))
  await expect.poll(() => viewerPage.evaluate(id =>
    window.__jazzSnapshots?.some(s => s.entities?.some(e =>
      e.id === id && e.version === 2 && e.payload?.content?.markdown?.includes("LIVE UPDATED"))),
  id), { timeout: 20000 }).toBe(true)
  await viewerPage.screenshot({ path: "/tmp/dim0-jazz-mvp-second-browser.png", fullPage: true })
  console.log("MVP_TWO_BROWSER_LIVE_UPDATE_PASS", boardId)
  await page.screenshot({ path: "/tmp/dim0-jazz-mvp-canvas.png", fullPage: true })
  await page.reload({ waitUntil: "domcontentloaded" })
  await expect.poll(async () => page.evaluate(async ({ boardId, id }) =>
    (await (await fetch("/patchboard-private/api/canvas?board_id=" + boardId, { credentials: "include" })).json()).entities.some(e => e.id === id),
  { boardId, id }), { timeout: 20000 }).toBe(true)
  await page.screenshot({ path: "/tmp/dim0-jazz-mvp-reload.png", fullPage: true })
  console.log("MVP_JAZZ_CANVAS_RELOAD_PASS", JSON.stringify({ boardId, id, pageErrors, consoleErrors: consoleErrors.slice(0, 8) }))
  assert.deepEqual(pageErrors, [], "Unexpected browser JavaScript errors")
} catch (error) {
  console.error("MVP_PROOF_FAILED", String(error))
  console.error("MVP_BROWSER_ERRORS", JSON.stringify(pageErrors))
  console.error("MVP_CONSOLE_ERRORS", JSON.stringify(consoleErrors.slice(0, 15)))
  await page.screenshot({ path: "/tmp/dim0-jazz-mvp-failure.png", fullPage: true }).catch(() => {})
  throw error
} finally {
  await browser.close()
}
