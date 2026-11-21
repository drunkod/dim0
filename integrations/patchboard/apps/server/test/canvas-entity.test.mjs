import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createJazz, sqlite } from "jazz-tools/backend";
import { app } from "@patchboard/jazz-schema";
import privatePermissions from "@patchboard/jazz-schema/private.permissions.json" with { type: "json" };
import {
  createCanvasEntity, updateCanvasEntity, listCanvasEntities,
  deleteCanvasEntity, CanvasConflict, CanvasPermissionDenied,
} from "../src/canvas-entity-service.ts";

process.env.JAZZ_APP_DIR = new URL("../../../packages/jazz-schema", import.meta.url).pathname;

test("Jazz persists all Dim0 node/link fields, enforces roles and version checks", async () => {
  const path = await mkdtemp(join(tmpdir(), "dim0-jazz-canvas-"));
  const open = () => createJazz({
    app, permissions: privatePermissions, store: sqlite({ path }),
    authenticate: () => null,
  }).ready();
  let dbServer = await open();
  const ownerId = randomUUID(), editorId = randomUUID(), viewerId = randomUUID();
  const boardId = randomUUID(), nodeId = randomUUID(), linkId = randomUUID();
  const note = {
    id: nodeId, type: "note", version: 1, graphUid: boardId,
    label: { markdown: "Original title" },
    content: { markdown: "<Widget state={{ count: 0 }}>hello</Widget>" },
    properties: { nodePosition: { position: { x: -32.5, y: 170.25 }, type: "position" } },
    style: { type: "applet", custom: { preserved: true } },
  };
  try {
    await dbServer.db.insert(app.boards, { title: "Jazz canvas", ownerId }, { id: boardId }).wait({ tier: "global" });
    await dbServer.db.insert(app.boardMembers, { boardId, userId: editorId, role: "editor" }).wait({ tier: "global" });
    await dbServer.db.insert(app.boardMembers, { boardId, userId: viewerId, role: "viewer" }).wait({ tier: "global" });

    const created = await createCanvasEntity(dbServer.db, {
      boardId, actorId: editorId, kind: "node", payload: note,
    });
    assert.equal(created.id, nodeId);
    assert.equal(created.version, 1);

    const link = {
      id: linkId, type: "link", version: 1, graphUid: boardId,
      source: nodeId, target: nodeId, properties: {}, style: {},
    };
    await createCanvasEntity(dbServer.db, {
      boardId, actorId: ownerId, kind: "link", payload: link,
    });
    assert.equal((await listCanvasEntities(dbServer.db, boardId, viewerId)).length, 2);
    assert.deepEqual((await dbServer.db.one(app.canvasEntities.where({ id: nodeId }))).payload, note);

    await assert.rejects(
      () => updateCanvasEntity(dbServer.db, {
        boardId, actorId: viewerId, id: nodeId, expectedVersion: 1,
        payload: { ...note, label: { markdown: "Viewer tampering" } },
      }),
      CanvasPermissionDenied,
    );
    await assert.rejects(
      () => updateCanvasEntity(dbServer.db, {
        boardId: randomUUID(), actorId: editorId, id: nodeId, expectedVersion: 1, payload: note,
      }),
      CanvasPermissionDenied,
    );
    const updated = await updateCanvasEntity(dbServer.db, {
      boardId, actorId: editorId, id: nodeId, expectedVersion: 1,
      payload: { ...note, label: { markdown: "Edited" } },
    });
    assert.equal(updated.version, 2);
    await assert.rejects(
      () => updateCanvasEntity(dbServer.db, {
        boardId, actorId: editorId, id: nodeId, expectedVersion: 1, payload: note,
      }),
      CanvasConflict,
    );
    await assert.rejects(
      () => deleteCanvasEntity(dbServer.db, { boardId, actorId: viewerId, id: linkId, expectedVersion: 1 }),
      CanvasPermissionDenied,
    );
  } finally {
    await dbServer.close();
  }

  dbServer = await open();
  try {
    const values = await listCanvasEntities(dbServer.db, boardId, ownerId);
    assert.equal(values.length, 2);
    assert.equal(values.find((row) => row.id === nodeId)?.payload.label.markdown, "Edited");
    await deleteCanvasEntity(dbServer.db, { boardId, actorId: ownerId, id: linkId, expectedVersion: 1 });
    assert.equal((await listCanvasEntities(dbServer.db, boardId, ownerId)).length, 1);
    console.log("DIM0_JAZZ_ENTITY_ROUNDTRIP_AUTHZ_RESTART_PASS", boardId);
  } finally {
    await dbServer.close();
    await rm(path, { recursive: true, force: true });
  }
});
