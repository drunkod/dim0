/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-003 branch, NOT a mock success.
 * Requirement: Email verification code/token lifecycle, expiry and replay safety
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/auth/local-auth/local-auth.service.ts::LocalAuthService.verifySignup
 * Owner: Identity, PR 7; gated acc.registration.003=false-until-verified.
 * Tests: ACC-003-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type VerifySignupEmailCommand = PlannedAccCommand<"ACC-003">;
export type VerifySignupEmailResult = PlannedAccResult<"ACC-003">;
export function runACC003(_input: VerifySignupEmailCommand): never {
  return notImplemented("ACC-003");
}
