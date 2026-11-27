/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-001 branch, NOT a mock success.
 * Requirement: Email signup, password hash, verification, session creation
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/auth/local-auth/local-auth.service.ts::LocalAuthService.signup
 * Owner: Identity, PR 7; gated legacy.passkey-auth=existing-real; acc.teable-email-parity=false.
 * Tests: ACC-001-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type SignupWithPasswordCommand = PlannedAccCommand<"ACC-001">;
export type SignupWithPasswordResult = PlannedAccResult<"ACC-001">;
export function runACC001(_input: SignupWithPasswordCommand): never {
  return notImplemented("ACC-001");
}
