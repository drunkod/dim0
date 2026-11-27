/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-067 branch, NOT a mock success.
 * Requirement: Create resource-bound, role-scoped invitation code
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/invitation/invitation.service.ts::InvitationService.generateInvitationLink
 * Owner: Collaboration, PR 8; gated legacy.board-invite=existing-real; account.invite-v2=false.
 * Tests: ACC-067-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type CreateInvitationLinkCommand = PlannedAccCommand<"ACC-067">;
export type CreateInvitationLinkResult = PlannedAccResult<"ACC-067">;
export function runACC067(_input: CreateInvitationLinkCommand): never {
  return notImplemented("ACC-067");
}
