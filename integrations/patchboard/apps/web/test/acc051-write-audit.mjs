/**
 * ACC-051 persisted audit: run ONLY inside the disposable server-stop window.
 * Jazz disallows a second process opening an active SQLite store. No external
 * or live backend is inspected or mutated.
 */
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {createJazz,sqlite} from "jazz-tools/backend";
import {app} from "@patchboard/jazz-schema";
import permissions from "@patchboard/jazz-schema/private.permissions.json" with {type:"json"};
const serverRequire=createRequire(new URL("../../server/package.json",import.meta.url));
serverRequire("tsx/esm/api").register();
process.env.JAZZ_APP_DIR=new URL("../../../packages/jazz-schema",import.meta.url).pathname;

export async function auditAcc051CanvasPatch(report){
  const root=process.env.PATCHBOARD_PRIVATE_ROOT;
  assert.ok(process.env.PATCHBOARD_PRIVATE_DEV==="1" &&
    process.env.PATCHBOARD_OAUTH_CI_RESTART==="1" &&
    root?.startsWith(join(tmpdir(),"patchboard-private-ci-")));
  const dbServer=await createJazz({app,permissions,
    store:sqlite({path:join(root,"jazz")}),authenticate:()=>null}).ready();
  try {
    const db=dbServer.db;
    const receipts=await db.all(app.canvasPatchReceipts.where({boardId:report.boardId}),
      {tier:"remote"});
    const events=await db.all(app.canvasPatchEvents.where({boardId:report.boardId}),
      {tier:"remote"});
    const primary=await db.one(app.canvasEntities.where({id:report.entityIds.primary}),
      {tier:"remote"});
    const racer=await db.one(app.canvasEntities.where({id:report.entityIds.racer}),
      {tier:"remote"});
    const untouched=await db.one(app.canvasEntities.where({id:report.entityIds.untouched}),
      {tier:"remote"});
    assert.equal(receipts.length,2,"one primary + one race-winner receipt");
    assert.equal(events.length,2,"one primary + one race-winner event");
    assert.equal(primary?.version,8);
    assert.equal(primary?.updatedBy,report.editorActorId);
    assert.equal(primary?.payload?.label?.markdown,report.fieldPatch.label_markdown);
    assert.equal(primary?.payload?.content?.markdown,"preserved-content");
    assert.equal(racer?.version,8);
    assert.equal(untouched?.version,7,"denied viewer/inherited write cannot change version");
    const firstReceipt=receipts.find(r=>r.id===report.receiptId);
    const firstEvent=events.find(e=>e.id===report.eventId);
    assert.ok(firstReceipt);
    assert.ok(firstEvent);
    assert.equal(firstReceipt.previousVersion,7);
    assert.equal(firstReceipt.committedVersion,8);
    assert.equal(firstReceipt.actorId,report.editorActorId);
    assert.equal(firstReceipt.eventId,firstEvent.id);
    assert.equal(firstEvent.receiptId,firstReceipt.id);
    assert.equal(firstEvent.entityId,report.entityIds.primary);
    assert.equal(firstEvent.actorId,report.editorActorId);
    assert.equal(firstEvent.previousVersion,7);
    assert.equal(firstEvent.committedVersion,8);
    assert.equal(firstEvent.field,"label.markdown");
    for(const receipt of receipts){
      assert.equal(events.filter(event=>event.receiptId===receipt.id).length,1);
    }
    for(const event of events){
      assert.equal(receipts.filter(receipt=>receipt.id===event.receiptId).length,1);
    }
    const raceEvent=events.find(event=>event.id!==report.eventId);
    assert.equal(raceEvent.entityId,report.entityIds.racer);
    const winnerId=report.raceWinner==="browser"?report.raceBrowserId:report.raceMcpId;
    const loserId=report.raceWinner==="browser"?report.raceMcpId:report.raceBrowserId;
    assert.equal(raceEvent.requestId,winnerId);
    assert.ok(!receipts.some(r=>r.requestId===loserId));
    assert.ok(!events.some(e=>e.requestId===loserId));
    assert.equal(racer.updatedBy,report.editorActorId);
    const result={
      boardId:report.boardId,entityIds:report.entityIds,
      writerActorId:report.editorActorId,
      priorVersion:7,committedVersion:8,
      receiptId:report.receiptId,eventId:report.eventId,
      persistedReceiptCount:receipts.length,persistedEventCount:events.length,
      raceWinner:report.raceWinner,
      raceWinnerVersion:racer.version,untouchedDeniedVersion:untouched.version,
      roleDowngradeDidNotResurrectReceipt:true
    };
    console.log("ACC051_PERSISTED_CANVAS_WRITE_AUDIT_PASS",JSON.stringify(result));
    return result;
  } finally {await dbServer.close();}
}
