/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-048 branch, NOT a mock success.
 * Requirement: Prevent managing equal or higher roles except explicit owner path
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec packages/core/src/auth/role/utils.ts::canManageRole
 * Owner: Authorization, PR 1; gated acc.authorization.048=false-until-verified.
 * Tests: ACC-048-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type CompareRoleSeniorityCommand = PlannedAccCommand<"ACC-048">;
export type CompareRoleSeniorityResult = PlannedAccResult<"ACC-048">;
export function runACC048(_input: CompareRoleSeniorityCommand): never {
  return notImplemented("ACC-048");
}
