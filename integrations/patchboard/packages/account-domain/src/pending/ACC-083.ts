/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-083 branch, NOT a mock success.
 * Requirement: Disconnect externally authorized clients
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/oauth/oauth.service.ts::OAuthService.revokeAccess
 * Owner: Integrations, PR 4; gated legacy.oauth=existing-real; acc.new-grant-operations=false.
 * Tests: ACC-083-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type RevokeOAuthGrantCommand = PlannedAccCommand<"ACC-083">;
export type RevokeOAuthGrantResult = PlannedAccResult<"ACC-083">;
export function runACC083(_input: RevokeOAuthGrantCommand): never {
  return notImplemented("ACC-083");
}
