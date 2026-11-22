/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-084 branch, NOT a mock success.
 * Requirement: Correlated signup/signin events with correct real user attribution
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/user/user.service.ts::UserService.recordSignup
 * Owner: Platform, PR 1; gated acc.audit.084=false-until-verified.
 * Tests: ACC-084-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type AuditSignupAndSigninCommand = PlannedAccCommand<"ACC-084">;
export type AuditSignupAndSigninResult = PlannedAccResult<"ACC-084">;
export function runACC084(_input: AuditSignupAndSigninCommand): never {
  return notImplemented("ACC-084");
}
