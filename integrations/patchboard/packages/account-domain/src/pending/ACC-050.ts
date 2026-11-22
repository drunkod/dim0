/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-050 branch, NOT a mock success.
 * Requirement: Resolve base-level membership
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/auth/permission.service.ts::PermissionService.getRoleByBaseId
 * Owner: Authorization, PR 1; gated acc.authorization.050=false-until-verified.
 * Tests: ACC-050-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type GetRoleByBaseCommand = PlannedAccCommand<"ACC-050">;
export type GetRoleByBaseResult = PlannedAccResult<"ACC-050">;
export function runACC050(_input: GetRoleByBaseCommand): never {
  return notImplemented("ACC-050");
}
