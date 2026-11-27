import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("OAuth reconnect recovers only one consented board for the same verified client/user", async () => {
  const root = await mkdtemp(join(tmpdir(), "jazz-consent-reconnect-"));
  process.env.PATCHBOARD_PRIVATE_ROOT = root;
  process.env.PATCHBOARD_PRIVATE_ORIGIN = "http://localhost:8999";
  process.env.PATCHBOARD_PRIVATE_PORT = "8999";
  process.env.PATCHBOARD_PRIVATE_DEV = "1";
  const { privateAuthDatabase, closePrivateAuthDatabase } =
    await import("../src/private-auth/db.ts");
  const { createPendingGrant, requireConsentBoundBoardGrant, revokeBoardGrant } =
    await import("../src/private-auth/grants.ts");
  try {
    const db = privateAuthDatabase();
    db.exec("CREATE TABLE oauthConsent (userId TEXT, clientId TEXT, referenceId TEXT, scopes TEXT)");
    const user = randomUUID(), client = randomUUID(), board = randomUUID();
    const addConsent = (grant, scopes) => db.prepare(
      "INSERT INTO oauthConsent(userId,clientId,referenceId,scopes) VALUES(?,?,?,?)",
    ).run(user, client, grant, JSON.stringify(scopes));
    const lookup = (id, who = user, app = client, scope = "board:read") =>
      requireConsentBoundBoardGrant(id, who, app, scope);

    assert.equal(lookup(undefined), null, "no prior consent means no access");
    const readGrant = createPendingGrant(user, client, board);
    addConsent(readGrant, ["board:read"]);
    assert.equal(lookup(undefined)?.boardId, board, "read consent recovered");
    assert.equal(lookup(undefined, user, client, "board:read board:write"), null,
      "a read-only consent cannot be upgraded by a write-scoped token");
    assert.equal(lookup(randomUUID()), null, "explicit invalid grant must not fall back");
    assert.equal(lookup(undefined, randomUUID()), null, "cannot use another user");
    assert.equal(lookup(undefined, user, randomUUID()), null, "cannot use another client");

    // A later consent for the same board does not create ambiguity.
    const writeGrant = createPendingGrant(user, client, board);
    addConsent(writeGrant, ["board:read", "board:write"]);
    assert.equal(lookup(undefined, user, client, "board:read board:write")?.boardId, board);

    // An owner may consent multiple boards to the same app; without an
    // explicit board claim the token must fail closed rather than guess.
    const secondBoard = randomUUID();
    const secondGrant = createPendingGrant(user, client, secondBoard);
    addConsent(secondGrant, ["board:read", "board:write"]);
    assert.equal(lookup(undefined), null, "multiple consented boards are ambiguous");
    assert.equal(lookup(writeGrant, user, client)?.boardId, board,
      "explicit valid grant stays scoped to its original board");

    revokeBoardGrant(secondGrant);
    assert.equal(lookup(undefined, user, client, "board:read board:write")?.boardId, board,
      "revoked grants do not count as authorized boards");
    revokeBoardGrant(writeGrant);
    assert.equal(lookup(undefined, user, client, "board:read board:write"), null,
      "revoked write grant cannot be reused");
  } finally {
    closePrivateAuthDatabase();
    await rm(root, { recursive: true, force: true, maxRetries: 4 });
  }
});
