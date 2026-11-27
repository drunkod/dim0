/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-081 branch, NOT a mock success.
 * Requirement: DCR validation, rate limit, PKCE and allowed scopes
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/oauth/oauth-registration.service.ts::OAuthRegistrationService.register
 * Owner: Integrations, PR 4; gated legacy.oauth=existing-real; acc.new-grant-operations=false.
 * Tests: ACC-081-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type RegisterOAuthClientCommand = PlannedAccCommand<"ACC-081">;
export type RegisterOAuthClientResult = PlannedAccResult<"ACC-081">;
export function runACC081(_input: RegisterOAuthClientCommand): never {
  return notImplemented("ACC-081");
}
