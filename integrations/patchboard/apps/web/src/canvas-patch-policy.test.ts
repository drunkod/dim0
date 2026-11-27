import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { createPolicyTestApp } from "jazz-tools/testing";
import { app } from "@patchboard/jazz-schema";
import guestPermissions from "../../../packages/jazz-schema/jazz.permissions.json" with { type: "json" };
import privatePermissions from "../../../packages/jazz-schema/private.permissions.json" with { type: "json" };

for (const [name, permissions] of [["guest", guestPermissions], ["private", privatePermissions]] as const) {
  test(name + " policy keeps canvas receipts and events server-only", async () => {
    const harness = await createPolicyTestApp(app, permissions, expect);
    try {
      const boardId = randomUUID(), actorId = randomUUID(), entityId = randomUUID();
      const receiptId = randomUUID(), eventId = randomUUID();
      await harness.seed(db => db.insert(app.boards, { title: "Canvas receipt test", ownerId: actorId }, { id: boardId }));
      const receipt = {
        boardId, entityId, actorId, requestId: "original", fingerprint: "fixture",
        previousVersion: 7, committedVersion: 8, committedPayload: { id: entityId }, eventId,
      };
      const event = { boardId, entityId, actorId, requestId: "original", receiptId,
        previousVersion: 7, committedVersion: 8, field: "label.markdown" as const };
      await harness.seed(db => db.insert(app.canvasPatchReceipts, receipt, { id: receiptId }));
      await harness.seed(db => db.insert(app.canvasPatchEvents, event, { id: eventId }));
      const editorId = randomUUID();
      await harness.seed(db => db.insert(app.boardMembers, { boardId, userId: editorId, role: "editor" }));
      const principals = [actorId, editorId, randomUUID()].map(account_id => harness.as({
        issuer: "https://policy-fixture.invalid", user_id: randomUUID(), account_id,
        authMode: "external", claims: {},
      }));
      principals.push(harness.as({ authMode: "device-account", user_id: "guest-device", claims: {} } as Parameters<typeof harness.as>[0]));
      for (const client of principals) {
        expect(await client.all(app.canvasPatchReceipts.where({ boardId }), { tier: "remote" })).toEqual([]);
        expect(await client.all(app.canvasPatchEvents.where({ boardId }), { tier: "remote" })).toEqual([]);
        await client.expectDenied(db => db.insert(app.canvasPatchReceipts, { ...receipt, requestId: "forged" }));
        await client.expectDenied(db => db.insert(app.canvasPatchEvents, { ...event, requestId: "forged" }));
        await client.expectDenied(db => db.update(app.canvasPatchReceipts, receiptId, { committedVersion: 9 }));
        await client.expectDenied(db => db.update(app.canvasPatchEvents, eventId, { committedVersion: 9 }));
        await client.expectDenied(db => db.delete(app.canvasPatchReceipts, receiptId));
        await client.expectDenied(db => db.delete(app.canvasPatchEvents, eventId));
      }
    } finally { await harness.shutdown(); }
  });
}
