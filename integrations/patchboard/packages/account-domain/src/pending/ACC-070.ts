/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-070 branch, NOT a mock success.
 * Requirement: Soft-delete invitation link and audit
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/invitation/invitation.service.ts::InvitationService.deleteInvitationLink
 * Owner: Collaboration, PR 8; gated legacy.board-invite=existing-real; account.invite-v2=false.
 * Tests: ACC-070-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type RevokeInvitationLinkCommand = PlannedAccCommand<"ACC-070">;
export type RevokeInvitationLinkResult = PlannedAccResult<"ACC-070">;
export function runACC070(_input: RevokeInvitationLinkCommand): never {
  return notImplemented("ACC-070");
}
