/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-019 branch, NOT a mock success.
 * Requirement: Validate one-time code then authenticate
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/auth/local-auth/local-auth.service.ts::LocalAuthService.signinWithCode
 * Owner: Identity, PR 7; gated acc.credentials.019=false-until-verified.
 * Tests: ACC-019-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type SigninWithEmailCodeCommand = PlannedAccCommand<"ACC-019">;
export type SigninWithEmailCodeResult = PlannedAccResult<"ACC-019">;
export function runACC019(_input: SigninWithEmailCodeCommand): never {
  return notImplemented("ACC-019");
}
