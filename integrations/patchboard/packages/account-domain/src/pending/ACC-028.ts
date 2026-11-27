/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-028 branch, NOT a mock success.
 * Requirement: GitHub OAuth login and link
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/auth/strategies/github.strategy.ts::GithubStrategy.validate
 * Owner: Identity, PR 7; gated acc.authentication.028=false-until-verified.
 * Tests: ACC-028-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type GithubLoginCommand = PlannedAccCommand<"ACC-028">;
export type GithubLoginResult = PlannedAccResult<"ACC-028">;
export function runACC028(_input: GithubLoginCommand): never {
  return notImplemented("ACC-028");
}
