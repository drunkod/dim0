/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-061 branch, NOT a mock success.
 * Requirement: Remove membership without deleting user globally
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/collaborator/collaborator.service.ts::CollaboratorService.deleteCollaborator
 * Owner: Collaboration, PR 8; gated acc.membership.061=false-until-verified.
 * Tests: ACC-061-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type RemoveMemberCommand = PlannedAccCommand<"ACC-061">;
export type RemoveMemberResult = PlannedAccResult<"ACC-061">;
export function runACC061(_input: RemoveMemberCommand): never {
  return notImplemented("ACC-061");
}
