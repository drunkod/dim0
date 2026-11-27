/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-058 branch, NOT a mock success.
 * Requirement: Return members with roles excluding hidden user data
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/collaborator/collaborator.service.ts::CollaboratorService.getListBySpace
 * Owner: Collaboration, PR 8; gated acc.membership.058=false-until-verified.
 * Tests: ACC-058-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type ListSpaceMembersCommand = PlannedAccCommand<"ACC-058">;
export type ListSpaceMembersResult = PlannedAccResult<"ACC-058">;
export function runACC058(_input: ListSpaceMembersCommand): never {
  return notImplemented("ACC-058");
}
