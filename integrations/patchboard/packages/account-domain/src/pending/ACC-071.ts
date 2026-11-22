/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-071 branch, NOT a mock success.
 * Requirement: List valid links subject to member rights
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/invitation/invitation.service.ts::InvitationService.getInvitationLink
 * Owner: Collaboration, PR 8; gated legacy.board-invite=existing-real; account.invite-v2=false.
 * Tests: ACC-071-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type ListInvitationLinksCommand = PlannedAccCommand<"ACC-071">;
export type ListInvitationLinksResult = PlannedAccResult<"ACC-071">;
export function runACC071(_input: ListInvitationLinksCommand): never {
  return notImplemented("ACC-071");
}
