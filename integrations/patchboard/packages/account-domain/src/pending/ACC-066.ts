/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-066 branch, NOT a mock success.
 * Requirement: Validate inviter, banned emails, create invitee identity/membership, mail and audit
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/invitation/invitation.service.ts::InvitationService.emailInvitation
 * Owner: Collaboration, PR 8; gated account.email-invite=false.
 * Tests: ACC-066-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type InviteEmailsCommand = PlannedAccCommand<"ACC-066">;
export type InviteEmailsResult = PlannedAccResult<"ACC-066">;
export function runACC066(_input: InviteEmailsCommand): never {
  return notImplemented("ACC-066");
}
