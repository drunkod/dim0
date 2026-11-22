/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-024 branch, NOT a mock success.
 * Requirement: Verify proposed email and current credential
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/auth/local-auth/local-auth.service.ts::LocalAuthService.sendChangeEmailCode
 * Owner: Identity, PR 7; gated acc.credentials.024=false-until-verified.
 * Tests: ACC-024-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type RequestEmailChangeCommand = PlannedAccCommand<"ACC-024">;
export type RequestEmailChangeResult = PlannedAccResult<"ACC-024">;
export function runACC024(_input: RequestEmailChangeCommand): never {
  return notImplemented("ACC-024");
}
