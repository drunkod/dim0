/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-030 branch, NOT a mock success.
 * Requirement: OIDC login with provider identity, state and deactivated check
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/auth/strategies/oidc.strategy.ts::OIDCStrategy.validate
 * Owner: Identity, PR 7; gated acc.authentication.030=false-until-verified.
 * Tests: ACC-030-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type OidcLoginCommand = PlannedAccCommand<"ACC-030">;
export type OidcLoginResult = PlannedAccResult<"ACC-030">;
export function runACC030(_input: OidcLoginCommand): never {
  return notImplemented("ACC-030");
}
