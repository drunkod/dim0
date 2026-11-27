/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-072 branch, NOT a mock success.
 * Requirement: Persist provenance and emit post-commit events
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/invitation/invitation.service.ts::InvitationService.recordInvitationAccept
 * Owner: Collaboration, PR 8; gated acc.invitations.072=false-until-verified.
 * Tests: ACC-072-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type RecordInvitationAcceptanceCommand = PlannedAccCommand<"ACC-072">;
export type RecordInvitationAcceptanceResult = PlannedAccResult<"ACC-072">;
export function runACC072(_input: RecordInvitationAcceptanceCommand): never {
  return notImplemented("ACC-072");
}
