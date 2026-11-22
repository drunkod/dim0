/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-056 branch, NOT a mock success.
 * Requirement: Create space membership, duplicate check, inherited base cleanup
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/collaborator/collaborator.service.ts::CollaboratorService.createSpaceCollaborator
 * Owner: Collaboration, PR 8; gated acc.membership.056=false-until-verified.
 * Tests: ACC-056-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type AddSpaceMemberCommand = PlannedAccCommand<"ACC-056">;
export type AddSpaceMemberResult = PlannedAccResult<"ACC-056">;
export function runACC056(_input: AddSpaceMemberCommand): never {
  return notImplemented("ACC-056");
}
