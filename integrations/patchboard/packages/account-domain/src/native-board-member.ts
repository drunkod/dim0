/**
 * Dim0-native per-BOARD Editor/Viewer update. No fabricated Space inheritance
 * or Owner/Creator role mapping. Source Teable CollaboratorService:
 * updateCollaborator, canManageRole, lockSpaceCollaborators; adapted with
 * Jazz serializable CAS, current owner guard and separate owner-transfer scope.
 */
export type EditableBoardRole = "viewer" | "editor";
export type ChangeNativeBoardRole = Readonly<{
  boardId: string;
  memberId: string;
  assignedRole: EditableBoardRole;
  expectedVersion: number;
  requestId: string;
}>;
export type NativeBoardRoleResult = Readonly<{
  memberId: string;
  previousRole: EditableBoardRole;
  assignedRole: EditableBoardRole;
  membershipVersion: number;
  changed: boolean;
  receiptId: string;
}>;
export type BoardRoleError =
  | "FORBIDDEN" | "MEMBER_NOT_FOUND" | "ROLE_NOT_SUPPORTED"
  | "STALE_MEMBER_VERSION" | "REQUEST_ID_CONFLICT" | "RECEIPT_STALE";
export class BoardRoleChangeError extends Error {
  constructor(readonly code: BoardRoleError) {
    super(code);
    this.name = "BoardRoleChangeError";
  }
}
export function assertEditableBoardRole(role: string): asserts role is EditableBoardRole {
  if (role !== "viewer" && role !== "editor")
    throw new BoardRoleChangeError("ROLE_NOT_SUPPORTED");
}
export function assertNativeRoleMutationAllowed(
  input: { actorId:string; ownerId:string; currentRole:string;
    memberId:string; expectedVersion:number; currentVersion:number }
): asserts input is typeof input {
  if (!input.actorId || input.actorId !== input.ownerId)
    throw new BoardRoleChangeError("FORBIDDEN");
  if (input.memberId === input.ownerId)
    throw new BoardRoleChangeError("FORBIDDEN"); // explicit owner transfer required
  assertEditableBoardRole(input.currentRole); // no legacy admin/agent remapping
  if (input.currentVersion !== input.expectedVersion)
    throw new BoardRoleChangeError("STALE_MEMBER_VERSION");
}
