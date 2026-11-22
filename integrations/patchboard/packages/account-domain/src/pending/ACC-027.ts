/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-027 branch, NOT a mock success.
 * Requirement: Google OAuth login, link issuer-scoped account
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/auth/strategies/google.strategy.ts::GoogleStrategy.validate
 * Owner: Identity, PR 7; gated acc.authentication.027=false-until-verified.
 * Tests: ACC-027-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type GoogleLoginCommand = PlannedAccCommand<"ACC-027">;
export type GoogleLoginResult = PlannedAccResult<"ACC-027">;
export function runACC027(_input: GoogleLoginCommand): never {
  return notImplemented("ACC-027");
}
