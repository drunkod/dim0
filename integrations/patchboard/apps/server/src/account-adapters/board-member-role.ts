/**
 * Real Jazz role mutation. Native board-scoped Editor/Viewer only:
 * no Space/Base inheritance, Teable Owner promotion, admin or agent alias.
 * Pinned Teable CollaboratorService.updateCollaborator (~905) uses a shared
 * collaborator lock and checks target/actor authority. Adapted here through
 * Jazz serializableTransaction, member.roleVersion and durable receipt.
 * Original Better Auth/Jazz actor created at trusted server auth boundary.
 */
import { createHash } from "node:crypto";
import type { Db } from "jazz-tools";
import { app } from "@patchboard/jazz-schema";
import {
  assertEditableBoardRole, assertNativeRoleMutationAllowed,
  BoardRoleChangeError, type ChangeNativeBoardRole,
  type NativeBoardRoleResult
} from "@patchboard/account-domain/native-board-member";

function deterministicReceiptId(boardId:string,actorId:string,requestId:string):string {
  const bytes=createHash("sha256")
    .update("dim0:native-board-role:v1\0")
    .update(boardId).update("\0")
    .update(actorId).update("\0")
    .update(requestId).digest();
  bytes[6]=(bytes[6]! & 0x0f)|0x50;
  bytes[8]=(bytes[8]! & 0x3f)|0x80;
  const h=bytes.subarray(0,16).toString("hex");
  return [h.slice(0,8),h.slice(8,12),h.slice(12,16),
    h.slice(16,20),h.slice(20)].join("-");
}
function inputFingerprint(input:ChangeNativeBoardRole):string {
  return createHash("sha256").update(JSON.stringify({
    boardId:input.boardId,memberId:input.memberId,
    assignedRole:input.assignedRole,expectedVersion:input.expectedVersion
  })).digest("hex");
}
export async function changeNativeBoardMemberRole(
  db:Db, actorId:string, input:ChangeNativeBoardRole
):Promise<NativeBoardRoleResult> {
  if (!actorId || !/^[a-zA-Z0-9_-]{1,128}$/.test(input.requestId))
    throw new BoardRoleChangeError("FORBIDDEN");
  assertEditableBoardRole(input.assignedRole);
  const receiptId=deterministicReceiptId(input.boardId,actorId,input.requestId);
  const fingerprint=inputFingerprint(input);
  const write=await db.serializableTransaction(async tx=>{
    // Always reauthorize BEFORE looking up a prior receipt; old receipts cannot
    // restore access after actor demotion, owner transfer or membership removal.
    const board=await tx.one(app.boards.where({id:input.boardId}));
    if (!board || board.ownerId!==actorId || input.memberId===board.ownerId)
      throw new BoardRoleChangeError("FORBIDDEN");
    const member=await tx.one(app.boardMembers.where({
      boardId:input.boardId,userId:input.memberId
    }));
    if (!member) throw new BoardRoleChangeError("MEMBER_NOT_FOUND");
    // A previous request can be safely replayed only while its resulting
    // membership is still active and matches original committed role/version.
    const prior=await tx.one(app.boardMemberRoleReceipts.where({id:receiptId}));
    if (prior) {
      if (prior.fingerprint!==fingerprint)
        throw new BoardRoleChangeError("REQUEST_ID_CONFLICT");
      if (prior.memberId!==member.id ||
          prior.membershipVersion!==member.roleVersion ||
          prior.assignedRole!==member.role)
        throw new BoardRoleChangeError("RECEIPT_STALE");
      return {
        memberId:member.userId,
        previousRole:prior.previousRole,
        assignedRole:prior.assignedRole,
        membershipVersion:prior.membershipVersion,
        changed:prior.changed,
        receiptId
      };
    }
    assertNativeRoleMutationAllowed({
      actorId,ownerId:board.ownerId,currentRole:member.role,
      memberId:member.userId,currentVersion:member.roleVersion,
      expectedVersion:input.expectedVersion
    });
    const previousRole=member.role as "viewer"|"editor";
    const changed=previousRole!==input.assignedRole;
    const membershipVersion=changed ? member.roleVersion+1 : member.roleVersion;
    if (changed) {
      tx.update(app.boardMembers,member.id,{
        role:input.assignedRole,roleVersion:membershipVersion
      });
    }
    // Actual Jazz receipt also serves as a sanitized membership-change audit:
    // no actor name/email, no secret. No duplicate audit on same-role no-op.
    tx.insert(app.boardMemberRoleReceipts,{
      boardId:input.boardId,memberId:member.id,actorId,
      requestId:input.requestId,fingerprint,
      previousRole,assignedRole:input.assignedRole,
      membershipVersion,changed
    },{id:receiptId});
    return {
      memberId:member.userId,previousRole,
      assignedRole:input.assignedRole,membershipVersion,
      changed,receiptId
    };
  });
  await write.wait({timeoutMs:10000});
  return write.value;
}
