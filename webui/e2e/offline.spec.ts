import { test, expect } from "@playwright/test"


/**
 * Offline service-worker test. The SW is NOT active under `vite dev`, so this
 * needs a production build + preview:
 *
 *   npm run build && npm run e2e:offline
 *
 * Skipped by the normal dev-server suite; the production config enables it.
 */
test.describe("offline (service worker)", () => {
  test.skip(process.env.DIM0_TEST_PROD_OFFLINE !== "1", "needs prod build + preview — SW is inactive under vite dev")

  test("app boots offline after first visit", async ({ page, context }) => {
    await page.goto("/local") // first visit: SW precaches the shell
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null)

    await context.setOffline(true)
    await page.goto("/local") // navigateFallback serves the shell offline
    await expect(page.getByRole("heading", { name: "On this device" })).toBeVisible()
  })

  test("Cyrillic face is precached before any Russian text is rendered", async ({ page, context, browserName }) => {
    await page.goto("/local")
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
    await context.setOffline(true)
    await page.goto("/local")
    await expect(page.getByRole("heading", { name: "On this device" })).toBeVisible()
    const loaded = await page.evaluate(async () => {
      const span = document.createElement("span")
      span.id = "offline-cyrillic-proof"
      span.className = "font-sans"
      span.style.cssText = "position:fixed;top:0;left:0;font-size:14px;font-weight:400"
      span.textContent = "Settings — Настройки Ёё"
      document.body.append(span)
      const faces = await document.fonts.load('400 14px "Noto Sans"', span.textContent)
      await document.fonts.ready
      return faces.filter(face => face.status === "loaded").length
    })
    expect(loaded).toBeGreaterThanOrEqual(2)
    if (browserName === "chromium") {
      const cdp = await context.newCDPSession(page)
      await cdp.send("DOM.enable")
      await cdp.send("CSS.enable")
      const { root } = await cdp.send("DOM.getDocument")
      const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: "#offline-cyrillic-proof" })
      const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId })
      expect(fonts.length).toBeGreaterThan(0)
      expect(fonts.every(font => font.isCustomFont && font.familyName === "Noto Sans")).toBe(true)
      await cdp.detach()
    }
  })
})
