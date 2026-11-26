// Intentionally executed via node --input-type=module with cwd apps/server
// by prove-jazz-upgrade.mjs, so each worktree resolves its own installed Jazz.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createJazz, sqlite } from "jazz-tools/backend";
import { app } from "@patchboard/jazz-schema";
import permissions from "@patchboard/jazz-schema/private.permissions.json" with { type: "json" };
import { createSavedTypedView, issueTypedViewShare, revokeTypedViewShare, querySavedTypedView, TypedViewAccessDenied } from "./src/typed-shared-view.ts";
import { privateAuthDatabase, closePrivateAuthDatabase } from "./src/private-auth/db.ts";
import { patchTypedRecord } from "./src/typed-record-patch.ts";

const root = process.env.PROOF_ROOT;
const phase = process.env.PROOF_PHASE;
const actualVersion = JSON.parse(readFileSync("node_modules/jazz-tools/package.json", "utf8")).version;
assert.equal(actualVersion, process.env.PROOF_VERSION);
assert.match(root, /dim0-jazz-version-proof-[^/]+\/(fixture|restored)$/);
mkdirSync(root, { recursive: true, mode: 0o700 });
Object.assign(process.env, {
  JAZZ_APP_DIR: resolve("../../packages/jazz-schema"),
  PATCHBOARD_PRIVATE_ROOT: root,
  PATCHBOARD_PRIVATE_ORIGIN: "http://localhost:19192",
  PATCHBOARD_PRIVATE_DEV: "1",
});
const manifestPath = join(root, "fixture.json");
const jazz = await createJazz({ app, permissions, store: sqlite({ path: join(root, "jazz") }), authenticate: () => null }).ready();
try {
  const sql = privateAuthDatabase();
  let fixture;
  if (phase === "seed") {
    const ownerSubject = randomUUID(), editorSubject = randomUUID(), readerSubject = randomUUID();
    const owner = await jazz.createAccountFor(ownerSubject), editor = await jazz.createAccountFor(editorSubject);
    const boardId = randomUUID(), memberId = randomUUID(), datasetId = randomUUID(), title = randomUUID(), computed = randomUUID(), recordId = randomUUID();
    const seed = (table, value, id) => jazz.db.insert(table, value, { id }).wait({ tier: "global" });
    await seed(app.boards, { ownerId: owner, title: "Version upgrade fixture" }, boardId);
    await seed(app.boardMembers, { boardId, userId: editor, role: "editor", roleVersion: 2 }, memberId);
    await seed(app.typedDatasets, { boardId, name: "Fixture dataset", schemaVersion: 3, state: "active" }, datasetId);
    await seed(app.typedFields, { boardId, datasetId, name: "Title", kind: "text" }, title);
    await seed(app.typedFields, { boardId, datasetId, name: "Title length", kind: "computed", computeFromFieldId: title }, computed);
    await seed(app.typedRecords, { boardId, datasetId, cells: { [title]: "Demo original", [computed]: 13 }, version: 7, updatedBy: owner }, recordId);
    const command = { boardId, datasetId, recordId, actorId: editor, schemaVersion: 3, expectedVersion: 7, requestId: "alpha69-write", set: { [title]: "Demo persisted" } };
    const patched = await patchTypedRecord(jazz.db, command);
    assert.equal(patched.version, 8);
    const definition = { name: "Demo items", allowedFieldIds: [title], filter: { op: "text_prefix", fieldId: title, value: "Demo" }, sort: { fieldId: title, direction: "asc" } };
    const view = await createSavedTypedView(jazz.db, { boardId, datasetId, actorId: owner, definition });
    const ref = { boardId, datasetId, viewId: view.viewId, actorId: owner, verifiedSubjectId: ownerSubject };
    const active = await issueTypedViewShare(jazz.db, sql, ref);
    const revoked = await issueTypedViewShare(jazz.db, sql, ref);
    await revokeTypedViewShare(jazz.db, sql, { ...ref, shareId: revoked.shareId, expectedVersion: 1 });
    fixture = { ownerSubject, editorSubject, readerSubject, owner, editor, boardId, memberId, datasetId, title, computed, recordId, viewId: view.viewId, activeToken: active.shareToken, revokedToken: revoked.shareToken, expectedVersion: 8, expectedText: "Demo persisted", receiptCount: 1 };
  } else {
    fixture = JSON.parse(readFileSync(manifestPath, "utf8"));
  }
  const { ownerSubject, editorSubject, readerSubject, owner, editor, boardId, memberId, datasetId, title, computed, recordId, viewId } = fixture;
  const verify = async () => {
    assert.equal(await jazz.createAccountFor(ownerSubject), owner);
    assert.equal(await jazz.createAccountFor(editorSubject), editor);
    assert.equal((await jazz.db.one(app.boards.where({ id: boardId }))).ownerId, owner);
    const member = await jazz.db.one(app.boardMembers.where({ id: memberId }));
    assert.equal(member.userId, editor);
    assert.equal(member.role, "editor");
    assert.equal(member.roleVersion, 2);
    const row = await jazz.db.one(app.typedRecords.where({ id: recordId }));
    assert.equal(row.updatedBy, editor);
    assert.equal(row.version, fixture.expectedVersion);
    assert.equal(row.cells[title], fixture.expectedText);
    assert.equal(row.cells[computed], Array.from(fixture.expectedText).length);
    const receipts = await jazz.db.all(app.typedPatchReceipts.where({ boardId }));
    const events = await jazz.db.all(app.typedPatchEvents.where({ boardId }));
    assert.equal(receipts.length, fixture.receiptCount);
    assert.equal(events.length, fixture.receiptCount);
    for (const receipt of receipts) assert.ok(events.some(event => event.id === receipt.eventId && event.receiptId === receipt.id));
    const query = { boardId, datasetId, viewId, verifiedSubjectId: readerSubject, channel: "browser", pageSize: 1 };
    assert.deepEqual((await querySavedTypedView(jazz.db, sql, { ...query, shareToken: fixture.activeToken })).rows,
      [{ id: recordId, version: fixture.expectedVersion, cells: { [title]: fixture.expectedText } }]);
    await assert.rejects(() => querySavedTypedView(jazz.db, sql, { ...query, shareToken: fixture.revokedToken }), TypedViewAccessDenied);
  };
  await verify();
  if (phase === "write") {
    const command = { boardId, datasetId, recordId, actorId: editor, schemaVersion: 3, expectedVersion: 8, requestId: "beta5-write", set: { [title]: "Demo upgraded" } };
    assert.equal((await patchTypedRecord(jazz.db, command)).version, 9);
    assert.equal((await patchTypedRecord(jazz.db, command)).version, 9);
    fixture.expectedVersion = 9;
    fixture.expectedText = "Demo upgraded";
    fixture.receiptCount = 2;
    await verify();
  }
  if (phase !== "verify") writeFileSync(manifestPath, JSON.stringify(fixture), { mode: 0o600 });
  console.log("JAZZ_VERSION_FIXTURE_PASS", actualVersion, phase, "record version", fixture.expectedVersion);
} finally {
  await jazz.close();
  closePrivateAuthDatabase();
}
