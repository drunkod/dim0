/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-069 branch, NOT a mock success.
 * Requirement: Recheck grant authority before changing link role
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/invitation/invitation.service.ts::InvitationService.updateInvitationLink
 * Owner: Collaboration, PR 8; gated acc.invitations.069=false-until-verified.
 * Tests: ACC-069-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type UpdateInvitationLinkRoleCommand = PlannedAccCommand<"ACC-069">;
export type UpdateInvitationLinkRoleResult = PlannedAccResult<"ACC-069">;
export function runACC069(_input: UpdateInvitationLinkRoleCommand): never {
  return notImplemented("ACC-069");
}
