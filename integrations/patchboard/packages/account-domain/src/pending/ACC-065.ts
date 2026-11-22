/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-065 branch, NOT a mock success.
 * Requirement: Plugin robot role never above installer's effective role
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/collaborator/collaborator.service.ts::CollaboratorService.addPluginUserToBase
 * Owner: Collaboration, PR 8; gated acc.membership.065=false-until-verified.
 * Tests: ACC-065-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type LimitPluginUserRoleCommand = PlannedAccCommand<"ACC-065">;
export type LimitPluginUserRoleResult = PlannedAccResult<"ACC-065">;
export function runACC065(_input: LimitPluginUserRoleCommand): never {
  return notImplemented("ACC-065");
}
