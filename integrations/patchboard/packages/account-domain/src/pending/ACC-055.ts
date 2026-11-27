/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-055 branch, NOT a mock success.
 * Requirement: Resolve table->base->space and grant ancestry
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/auth/permission.service.ts::PermissionService.getUpperIdByBaseId
 * Owner: Authorization, PR 1; gated acc.authorization.055=false-until-verified.
 * Tests: ACC-055-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type ResolveResourceAncestorsCommand = PlannedAccCommand<"ACC-055">;
export type ResolveResourceAncestorsResult = PlannedAccResult<"ACC-055">;
export function runACC055(_input: ResolveResourceAncestorsCommand): never {
  return notImplemented("ACC-055");
}
