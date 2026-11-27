/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-025 branch, NOT a mock success.
 * Requirement: Update unique email, sessions and account projections
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/auth/local-auth/local-auth.service.ts::LocalAuthService.changeEmail
 * Owner: Identity, PR 7; gated acc.credentials.025=false-until-verified.
 * Tests: ACC-025-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type ChangeEmailCommand = PlannedAccCommand<"ACC-025">;
export type ChangeEmailResult = PlannedAccResult<"ACC-025">;
export function runACC025(_input: ChangeEmailCommand): never {
  return notImplemented("ACC-025");
}
