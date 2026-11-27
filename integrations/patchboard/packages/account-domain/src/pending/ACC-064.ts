/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-064 branch, NOT a mock success.
 * Requirement: Inviter cannot grant stronger role than allowed
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/collaborator/collaborator.service.ts::CollaboratorService.validateUserAddRole
 * Owner: Collaboration, PR 8; gated acc.membership.064=false-until-verified.
 * Tests: ACC-064-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type LimitInviterRoleCommand = PlannedAccCommand<"ACC-064">;
export type LimitInviterRoleResult = PlannedAccResult<"ACC-064">;
export function runACC064(_input: LimitInviterRoleCommand): never {
  return notImplemented("ACC-064");
}
