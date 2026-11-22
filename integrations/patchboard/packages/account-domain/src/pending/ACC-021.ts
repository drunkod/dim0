/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-021 branch, NOT a mock success.
 * Requirement: Email reset link with bounded TTL and rate limit
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/auth/local-auth/local-auth.service.ts::LocalAuthService.sendResetPasswordEmail
 * Owner: Identity, PR 7; gated acc.credentials.021=false-until-verified.
 * Tests: ACC-021-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type RequestPasswordResetCommand = PlannedAccCommand<"ACC-021">;
export type RequestPasswordResetResult = PlannedAccResult<"ACC-021">;
export function runACC021(_input: RequestPasswordResetCommand): never {
  return notImplemented("ACC-021");
}
