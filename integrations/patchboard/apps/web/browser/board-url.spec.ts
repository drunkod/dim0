import { expect, test } from "@playwright/test";

test("board ID in URL survives reload with duplicate board titles", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Jazz shared · connected")).toBeVisible();

  await page.getByPlaceholder("New board title").fill("Duplicated Title");
  await page.getByPlaceholder("New board title").press("Enter");
  await expect(page.getByRole("heading", { name: "Duplicated Title" })).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get("board")).toBeTruthy();
  const firstId = new URL(page.url()).searchParams.get("board");

  await page.getByPlaceholder("Write a note…").fill("First board only");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.locator(".note").filter({ hasText: "First board only" })).toBeVisible();

  await page.getByPlaceholder("New board title").fill("Duplicated Title");
  await page.getByPlaceholder("New board title").press("Enter");
  await expect.poll(() => new URL(page.url()).searchParams.get("board")).not.toBe(firstId);
  const secondId = new URL(page.url()).searchParams.get("board");
  await page.getByPlaceholder("Write a note…").fill("Second board only");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.locator(".note").filter({ hasText: "Second board only" })).toBeVisible();

  await page.reload();
  await expect(page.getByText("Jazz shared · connected")).toBeVisible();
  await expect(page.locator(".note").filter({ hasText: "Second board only" })).toBeVisible();
  await expect(page.locator(".note").filter({ hasText: "First board only" })).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get("board")).toBe(secondId);

  await page.goto("/?board=" + firstId);
  await expect(page.locator(".note").filter({ hasText: "First board only" })).toBeVisible();
  await expect(page.locator(".note").filter({ hasText: "Second board only" })).toHaveCount(0);
});
