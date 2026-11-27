import { expect, test } from "@playwright/test";

test("a board and its moved note survive reopening", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/Jazz (local-first|shared) · connected/)).toBeVisible();
  await page.getByPlaceholder("New board title").fill("Planning");
  await page.getByPlaceholder("New board title").press("Enter");
  await expect(page.getByRole("heading", { name: "Planning" })).toBeVisible();
  await page.getByPlaceholder("Write a note…").fill("Prepare demo");
  await page.getByRole("button", { name: "Add note" }).click();
  const note = page.locator(".note").filter({ hasText: "Prepare demo" });
  await expect(note).toBeVisible();
  const initialX = await note.evaluate(el => parseFloat(getComputedStyle(el).left));
  await note.getByRole("button", { name: "Move note →" }).click();
  await expect(note).toHaveCSS("left", `${initialX + 30}px`);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Planning" })).toBeVisible();
  await expect(note).toHaveCSS("left", `${initialX + 30}px`);
});
