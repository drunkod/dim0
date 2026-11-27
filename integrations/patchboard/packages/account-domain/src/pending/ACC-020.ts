/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-020 branch, NOT a mock success.
 * Requirement: Old-password check, new credential, session revocation
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/auth/local-auth/local-auth.service.ts::LocalAuthService.changePassword
 * Owner: Identity, PR 7; gated acc.credentials.020=false-until-verified.
 * Tests: ACC-020-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type ChangePasswordCommand = PlannedAccCommand<"ACC-020">;
export type ChangePasswordResult = PlannedAccResult<"ACC-020">;
export function runACC020(_input: ChangePasswordCommand): never {
  return notImplemented("ACC-020");
}
