/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-078 branch, NOT a mock success.
 * Requirement: Refresh token safely and invalidate previous signature
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/access-token/access-token.service.ts::AccessTokenService.refreshAccessToken
 * Owner: Integrations, PR 4; gated acc.tokens.078=false-until-verified.
 * Tests: ACC-078-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type RotatePersonalTokenCommand = PlannedAccCommand<"ACC-078">;
export type RotatePersonalTokenResult = PlannedAccResult<"ACC-078">;
export function runACC078(_input: RotatePersonalTokenCommand): never {
  return notImplemented("ACC-078");
}
