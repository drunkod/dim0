/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-059 branch, NOT a mock success.
 * Requirement: List board/project members and roles
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/collaborator/collaborator.service.ts::CollaboratorService.getListByBase
 * Owner: Collaboration, PR 8; gated acc.membership.059=false-until-verified.
 * Tests: ACC-059-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type ListBaseMembersCommand = PlannedAccCommand<"ACC-059">;
export type ListBaseMembersResult = PlannedAccResult<"ACC-059">;
export function runACC059(_input: ListBaseMembersCommand): never {
  return notImplemented("ACC-059");
}
