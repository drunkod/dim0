/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-088 branch, NOT a mock success.
 * Requirement: Rate limiting, turnstile and signin failure handling
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/auth/local-auth/local-auth.service.ts::LocalAuthService.validateTurnstileIfEnabled
 * Owner: Identity + Platform, PR 1; gated acc.security.088=false-until-verified.
 * Tests: ACC-088-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type ProtectLoginAbuseCommand = PlannedAccCommand<"ACC-088">;
export type ProtectLoginAbuseResult = PlannedAccResult<"ACC-088">;
export function runACC088(_input: ProtectLoginAbuseCommand): never {
  return notImplemented("ACC-088");
}
