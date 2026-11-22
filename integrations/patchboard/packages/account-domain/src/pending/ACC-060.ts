/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-060 branch, NOT a mock success.
 * Requirement: Role update, hierarchy, last owner guard and audit
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/collaborator/collaborator.service.ts::CollaboratorService.updateCollaborator
 * Owner: Collaboration, PR 8; gated acc.membership.060=false-until-verified.
 * Tests: ACC-060-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type ChangeMemberRoleCommand = PlannedAccCommand<"ACC-060">;
export type ChangeMemberRoleResult = PlannedAccResult<"ACC-060">;
export function runACC060(_input: ChangeMemberRoleCommand): never {
  return notImplemented("ACC-060");
}
