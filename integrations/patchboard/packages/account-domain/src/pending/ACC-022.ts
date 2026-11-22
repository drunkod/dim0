/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-022 branch, NOT a mock success.
 * Requirement: Atomic one-time reset code, credential update and session purge
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/auth/local-auth/local-auth.service.ts::LocalAuthService.resetPassword
 * Owner: Identity, PR 7; gated acc.credentials.022=false-until-verified.
 * Tests: ACC-022-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type ConsumePasswordResetCommand = PlannedAccCommand<"ACC-022">;
export type ConsumePasswordResetResult = PlannedAccResult<"ACC-022">;
export function runACC022(_input: ConsumePasswordResetCommand): never {
  return notImplemented("ACC-022");
}
