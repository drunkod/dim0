/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-014 branch, NOT a mock success.
 * Requirement: Record failed login metadata safely for abuse prevention
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/user/user.service.ts::UserService.recordSigninFailure
 * Owner: Identity, PR 7; gated acc.identity.014=false-until-verified.
 * Tests: ACC-014-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type RecordSigninFailureCommand = PlannedAccCommand<"ACC-014">;
export type RecordSigninFailureResult = PlannedAccResult<"ACC-014">;
export function runACC014(_input: RecordSigninFailureCommand): never {
  return notImplemented("ACC-014");
}
