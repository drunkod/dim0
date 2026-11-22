/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-077 branch, NOT a mock success.
 * Requirement: Validate expiration, signature, status and actor
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/access-token/access-token.service.ts::AccessTokenService.validate
 * Owner: Integrations, PR 4; gated legacy.oauth=existing-real; acc.new-grant-operations=false.
 * Tests: ACC-077-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type ValidatePersonalTokenCommand = PlannedAccCommand<"ACC-077">;
export type ValidatePersonalTokenResult = PlannedAccResult<"ACC-077">;
export function runACC077(_input: ValidatePersonalTokenCommand): never {
  return notImplemented("ACC-077");
}
