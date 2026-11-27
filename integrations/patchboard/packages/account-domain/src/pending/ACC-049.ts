/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-049 branch, NOT a mock success.
 * Requirement: Resolve direct and department user membership in space
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/auth/permission.service.ts::PermissionService.getRoleBySpaceId
 * Owner: Authorization, PR 1; gated acc.authorization.049=false-until-verified.
 * Tests: ACC-049-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type GetRoleBySpaceCommand = PlannedAccCommand<"ACC-049">;
export type GetRoleBySpaceResult = PlannedAccResult<"ACC-049">;
export function runACC049(_input: GetRoleBySpaceCommand): never {
  return notImplemented("ACC-049");
}
