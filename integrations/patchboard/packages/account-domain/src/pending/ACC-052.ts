/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-052 branch, NOT a mock success.
 * Requirement: Guards always evaluate current actor action and resource
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/auth/guard/permission.guard.ts::PermissionGuard.checkPermissions
 * Owner: Authorization, PR 1; gated acc.authorization.052=false-until-verified.
 * Tests: ACC-052-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type RequirePermissionCommand = PlannedAccCommand<"ACC-052">;
export type RequirePermissionResult = PlannedAccResult<"ACC-052">;
export function runACC052(_input: RequirePermissionCommand): never {
  return notImplemented("ACC-052");
}
