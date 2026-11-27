/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-029 branch, NOT a mock success.
 * Requirement: Apple login and callback/error handling
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/auth/strategies/apple.strategy.ts::AppleStrategy.validate
 * Owner: Identity, PR 7; gated acc.authentication.029=false-until-verified.
 * Tests: ACC-029-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type AppleLoginCommand = PlannedAccCommand<"ACC-029">;
export type AppleLoginResult = PlannedAccResult<"ACC-029">;
export function runACC029(_input: AppleLoginCommand): never {
  return notImplemented("ACC-029");
}
