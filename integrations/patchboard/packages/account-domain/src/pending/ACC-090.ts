/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-090 branch, NOT a mock success.
 * Requirement: Share links cannot grant excluded account/email/integration operations
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/auth/permission.service.ts::PermissionService.getBaseSharePermissions
 * Owner: Identity + Platform, PR 1; gated acc.security.090=false-until-verified.
 * Tests: ACC-090-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type RestrictGuestShareCommand = PlannedAccCommand<"ACC-090">;
export type RestrictGuestShareResult = PlannedAccResult<"ACC-090">;
export function runACC090(_input: RestrictGuestShareCommand): never {
  return notImplemented("ACC-090");
}
