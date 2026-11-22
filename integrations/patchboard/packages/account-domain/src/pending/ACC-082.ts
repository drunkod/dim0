/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-082 branch, NOT a mock success.
 * Requirement: Consent and secure OAuth code/token lifecycle
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/oauth/oauth-server.service.ts::OAuthServerService.authorize
 * Owner: Integrations, PR 4; gated legacy.oauth=existing-real; acc.new-grant-operations=false.
 * Tests: ACC-082-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type AuthorizeOAuthClientCommand = PlannedAccCommand<"ACC-082">;
export type AuthorizeOAuthClientResult = PlannedAccResult<"ACC-082">;
export function runACC082(_input: AuthorizeOAuthClientCommand): never {
  return notImplemented("ACC-082");
}
