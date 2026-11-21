import { afterEach, beforeEach, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { createPolicyTestApp, type PolicyTestApp } from "jazz-tools/testing";
import { app } from "@patchboard/jazz-schema";
import privatePermissions from "../../../packages/jazz-schema/private.permissions.json" with { type: "json" };

let testApp: PolicyTestApp;
const issuer = "https://private.patchboard.invalid";
const identities = { owner: randomUUID(), editor: randomUUID(), viewer: randomUUID(), outsider: randomUUID() };
const accounts = { owner: randomUUID(), editor: randomUUID(), viewer: randomUUID(), outsider: randomUUID() };
const as = (name: keyof typeof identities) =>
  testApp.as({
    issuer,
    user_id: identities[name],
    account_id: accounts[name],
    claims: {},
    authMode: "external",
  });

beforeEach(async () => {
  testApp = await createPolicyTestApp(app, privatePermissions, expect);
});
afterEach(async () => {
  await testApp.shutdown();
});

test("private board data is invisible to an outsider and all device guests", async () => {
  const boardId = randomUUID();
  const board = await testApp.seed((db) =>
    db.insert(app.boards, { title: "Secret board", ownerId: accounts.owner }, { id: boardId }),
  );
  await testApp.seed((db) =>
    db.insert(app.boardMembers, { boardId, userId: accounts.editor, role: "editor" }),
  );
  await testApp.seed((db) =>
    db.insert(app.boardMembers, { boardId, userId: accounts.viewer, role: "viewer" }),
  );
  const note = await testApp.seed((db) =>
    db.insert(app.shapes, {
      boardId, kind: "note", text: "Private content", x: 40, y: 45,
      width: 150, height: 90, fill: "#ffff88", zIndex: 0,
    }),
  );
  for (const member of ["owner", "editor", "viewer"] as const) {
    expect((await as(member).all(app.boards.where({ id: board.id }), { tier: "remote" })).map(r => r.id)).toEqual([boardId]);
    expect((await as(member).all(app.shapes.where({ boardId }), { tier: "remote" })).map(r => r.id)).toEqual([note.id]);
  }
  const outsider = as("outsider");
  expect(await outsider.all(app.boards.where({ id: boardId }), { tier: "remote" })).toEqual([]);
  expect(await outsider.all(app.shapes.where({ boardId }), { tier: "remote" })).toEqual([]);
  // The actual device-account fixture must have NO caller-chosen account_id:
  // Jazz derives its founding account from its verified device key. This
  // Jazz alpha's exposed TypeScript session union still requires a cast.
  const guest = testApp.as({
    authMode: "device-account", user_id: "untrusted-device", claims: {},
  } as Parameters<typeof testApp.as>[0]);
  expect(await guest.all(app.boards.where({ id: boardId }), { tier: "remote" })).toEqual([]);
  expect(await guest.all(app.shapes.where({ boardId }), { tier: "remote" })).toEqual([]);
});

test("no browser principal can forge memberships, invitation or attribution by raw Jazz writes", async () => {
  const boardId = randomUUID();
  await testApp.seed((db) => db.insert(app.boards, { title: "Private", ownerId: accounts.owner }, { id: boardId }));
  await testApp.seed((db) => db.insert(app.boardMembers, { boardId, userId: accounts.editor, role: "editor" }));
  const editor = as("editor");
  const owner = as("owner");
  await editor.expectDenied((db) => db.insert(app.shapes, {
    boardId, kind: "note", text: "Forged", x: 1, y: 2,
    width: 100, height: 100, fill: "#fff", zIndex: 0,
  }));
  await owner.expectDenied((db) => db.insert(app.boardInvites, {
    boardId, token: "client-chosen-secret", role: "editor", singleUse: true,
  }));
  await editor.expectDenied((db) => db.insert(app.boardMembers, {
    boardId, userId: accounts.outsider, role: "admin",
  }));
  await as("viewer").expectDenied((db) => db.insert(app.boards, {
    title: "Forged owner", ownerId: accounts.viewer,
  }));
});
