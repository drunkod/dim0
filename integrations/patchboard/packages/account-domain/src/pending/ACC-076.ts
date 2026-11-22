/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-076 branch, NOT a mock success.
 * Requirement: Issue scoped token with expiry/resource bounds and stored signature
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/access-token/access-token.service.ts::AccessTokenService.createAccessToken
 * Owner: Integrations, PR 4; gated legacy.oauth=existing-real; acc.new-grant-operations=false.
 * Tests: ACC-076-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type CreatePersonalTokenCommand = PlannedAccCommand<"ACC-076">;
export type CreatePersonalTokenResult = PlannedAccResult<"ACC-076">;
export function runACC076(_input: CreatePersonalTokenCommand): never {
  return notImplemented("ACC-076");
}
