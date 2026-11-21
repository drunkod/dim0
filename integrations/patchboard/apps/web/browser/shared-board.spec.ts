import { expect, test } from "@playwright/test";

test("two independent profiles see the same edited and moved note", async ({ browser }) => {
  const owner = await browser.newContext();
  const editor = await browser.newContext();
  const ownerPage = await owner.newPage();
  const editorPage = await editor.newPage();
  await ownerPage.goto("/");
  await editorPage.goto("/");
  await expect(ownerPage.getByText("Jazz shared · connected")).toBeVisible();
  await expect(editorPage.getByText("Jazz shared · connected")).toBeVisible();

  await ownerPage.getByPlaceholder("New board title").fill("M1 Planning");
  await ownerPage.getByPlaceholder("New board title").press("Enter");
  await expect(ownerPage.getByRole("heading", { name: "M1 Planning" })).toBeVisible();

  await editorPage.reload();
  await expect(editorPage.getByRole("button", { name: "M1 Planning" }).first()).toBeVisible();
  await editorPage.getByRole("button", { name: "M1 Planning" }).first().click();

  await ownerPage.getByPlaceholder("Write a note…").fill("Initial note");
  await ownerPage.getByRole("button", { name: "Add note" }).click();
  const ownerNote = ownerPage.locator(".note").filter({ hasText: "Initial note" });
  await expect(ownerNote).toBeVisible();

  const editorNote = editorPage.locator(".note").filter({ hasText: "Initial note" });
  await expect(editorNote).toBeVisible();
  await editorNote.getByRole("button", { name: "Edit note" }).click();
  await editorPage.getByRole("textbox", { name: "Note text" }).fill("Edited by profile B");
  await editorPage.getByRole("button", { name: "Save note" }).click();
  await expect(ownerPage.locator(".note").filter({ hasText: "Edited by profile B" })).toBeVisible();

  const editedOwnerNote = ownerPage.locator(".note").filter({ hasText: "Edited by profile B" });
  const editedEditorNote = editorPage.locator(".note").filter({ hasText: "Edited by profile B" });
  const before = await editedEditorNote.evaluate((element) => parseFloat(getComputedStyle(element).left));
  await editedEditorNote.getByRole("button", { name: "Move note →" }).click();
  await expect(editedOwnerNote).toHaveCSS("left", `${before + 30}px`);
  await ownerPage.waitForTimeout(1000);
  await editorPage.waitForTimeout(1000);
  await ownerPage.reload();
  await editorPage.reload();
  await expect(ownerPage.getByRole("heading", { name: "M1 Planning" })).toBeVisible();
  await expect(editorPage.getByRole("heading", { name: "M1 Planning" })).toBeVisible();
  await expect(ownerPage.locator(".note").filter({ hasText: "Edited by profile B" })).toBeVisible();
  await expect(editorPage.locator(".note").filter({ hasText: "Edited by profile B" })).toBeVisible();
  await expect(ownerPage.locator(".note").filter({ hasText: "Edited by profile B" })).toHaveCSS("left", `${before + 30}px`);

  await owner.close();
  await editor.close();
});
