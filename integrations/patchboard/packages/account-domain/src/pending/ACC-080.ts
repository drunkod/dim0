/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-080 branch, NOT a mock success.
 * Requirement: List current user's tokens without exposing signing secrets
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/access-token/access-token.service.ts::AccessTokenService.listAccessToken
 * Owner: Integrations, PR 4; gated acc.tokens.080=false-until-verified.
 * Tests: ACC-080-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type ListPersonalTokensCommand = PlannedAccCommand<"ACC-080">;
export type ListPersonalTokensResult = PlannedAccResult<"ACC-080">;
export function runACC080(_input: ListPersonalTokensCommand): never {
  return notImplemented("ACC-080");
}
