/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-068 branch, NOT a mock success.
 * Requirement: Validate code, resource, expiry and member uniqueness
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/invitation/invitation.service.ts::InvitationService.acceptInvitationLink
 * Owner: Collaboration, PR 8; gated legacy.board-invite=existing-real; account.invite-v2=false.
 * Tests: ACC-068-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type AcceptInvitationLinkCommand = PlannedAccCommand<"ACC-068">;
export type AcceptInvitationLinkResult = PlannedAccResult<"ACC-068">;
export function runACC068(_input: AcceptInvitationLinkCommand): never {
  return notImplemented("ACC-068");
}
