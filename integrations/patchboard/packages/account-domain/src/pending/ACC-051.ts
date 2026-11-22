/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-051 branch, NOT a mock success.
 * Requirement: Union applicable space/base role rights then cap by token
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/auth/permission.service.ts::PermissionService.getPermissions
 * Owner: Authorization, PR 1; gated acc.authorization.051=false-until-verified.
 * Tests: ACC-051-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type EffectivePermissionsCommand = PlannedAccCommand<"ACC-051">;
export type EffectivePermissionsResult = PlannedAccResult<"ACC-051">;
export function runACC051(_input: EffectivePermissionsCommand): never {
  return notImplemented("ACC-051");
}
