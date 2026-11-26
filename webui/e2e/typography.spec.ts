import { test, expect } from "@playwright/test"
import { readFileSync } from "node:fs"


// Exercise the shipped font declarations and shared utility in the real app,
// not a fixture that installs its own font. Separate glyph runs let Chromium
// report the actual platform font rather than just the computed CSS family.
test("UI sans uses the same bundled face for Latin and Cyrillic", async ({ page, browserName }) => {
  const remoteFonts: string[] = []
  page.on("request", request => {
    if (request.resourceType() === "font" && !new URL(request.url()).hostname.match(/^(localhost|127\.0\.0\.1)$/)) {
      remoteFonts.push(request.url())
    }
  })
  await page.goto("/local")
  await expect(page.getByRole("heading", { name: "On this device" })).toBeVisible()

  const results = await page.evaluate(async () => {
    const fixture = document.createElement("section")
    fixture.id = "typography-proof"
    fixture.className = "font-sans"
    fixture.style.cssText = "position:fixed;inset:16px auto auto 16px;background:var(--background);color:var(--foreground);padding:12px;z-index:9999"
    const samples = ["Settings ABC", "Настройки Ёё Йй Щщ", "Save — Сохранить 123"]
    const spans = samples.map((sample, index) => {
      const span = document.createElement("span")
      span.id = `typography-sample-${index}`
      span.lang = index === 0 ? "en" : "ru"
      span.style.cssText = "display:block;font-size:14px;line-height:20px;font-weight:400"
      span.textContent = sample
      fixture.append(span)
      return span
    })
    document.body.append(fixture)
    const loaded = await Promise.all(
      [400, 500, 600, 700].flatMap(weight => samples.map(sample =>
        document.fonts.load(`${weight} 14px "Noto Sans"`, sample).then(faces => faces.length),
      )).concat([400, 700].flatMap(weight => samples.map(sample =>
        document.fonts.load(`italic ${weight} 14px "Noto Sans"`, sample).then(faces => faces.length),
      ))),
    )
    await document.fonts.ready
    return {
      loaded,
      families: spans.map(span => getComputedStyle(span).fontFamily.split(",")[0].replace(/["']/g, "")),
      heights: spans.map(span => span.getBoundingClientRect().height),
    }
  })
  const headingFamily = await page.getByRole("heading", { name: "On this device" }).evaluate(
    node => getComputedStyle(node).fontFamily.split(",")[0].replace(/["']/g, ""),
  )
  expect(headingFamily).toBe("Noto Sans")
  expect(results.families).toEqual(["Noto Sans", "Noto Sans", "Noto Sans"])
  expect(results.loaded.every(count => count > 0)).toBe(true)
  expect(results.heights).toEqual([20, 20, 20])
  expect(remoteFonts).toEqual([])

  if (browserName === "chromium") {
    const session = await page.context().newCDPSession(page)
    await session.send("DOM.enable")
    await session.send("CSS.enable")
    const { root } = await session.send("DOM.getDocument")
    for (let index = 0; index < 3; index++) {
      const { nodeId } = await session.send("DOM.querySelector", {
        nodeId: root.nodeId,
        selector: `#typography-sample-${index}`,
      })
      const { fonts } = await session.send("CSS.getPlatformFontsForNode", { nodeId })
      expect(fonts.length).toBeGreaterThan(0)
      expect(fonts.every(font => font.isCustomFont && font.familyName === "Noto Sans")).toBe(true)
    }
    await session.detach()
  }
  await test.info().attach("mixed-script-typography", {
    body: await page.locator("#typography-proof").screenshot(),
    contentType: "image/png",
  })
})


test("standalone desktop OAuth pages embed Latin and Cyrillic offline", async ({ page, context }) => {
  await context.setOffline(true)
  for (const name of ["oauth-success", "oauth-error"]) {
    await page.setContent(readFileSync(new URL(`../src-tauri/src/${name}.html`, import.meta.url), "utf8"))
    const result = await page.evaluate(async () => {
      const heading = document.querySelector("h1")!
      heading.textContent = "Settings / Настройки Ёё"
      const text = heading.textContent
      const faces = await document.fonts.load('700 20px "Noto Sans"', text)
      await document.fonts.ready
      return {
        family: getComputedStyle(heading).fontFamily.split(",")[0].replace(/["']/g, ""),
        loaded: faces.filter(face => face.status === "loaded").length,
      }
    })
    expect(result.family).toBe("Noto Sans")
    expect(result.loaded).toBeGreaterThanOrEqual(2)
  }
})
