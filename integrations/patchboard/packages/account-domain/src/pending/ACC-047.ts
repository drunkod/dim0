/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-047 branch, NOT a mock success.
 * Requirement: Use exact 5-role 67-action matrix as documented baseline
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec packages/core/src/auth/role/constant.ts::RolePermission
 * Owner: Authorization, PR 1; gated acc.authorization.047=false-until-verified.
 * Tests: ACC-047-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type GetRolePermissionMatrixCommand = PlannedAccCommand<"ACC-047">;
export type GetRolePermissionMatrixResult = PlannedAccResult<"ACC-047">;
export function runACC047(_input: GetRolePermissionMatrixCommand): never {
  return notImplemented("ACC-047");
}
