/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-013 branch, NOT a mock success.
 * Requirement: Audit true signup once; emit post-commit, preserve invited-account claim
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/user/user.service.ts::UserService.recordSignup
 * Owner: Identity, PR 7; gated acc.identity.013=false-until-verified.
 * Tests: ACC-013-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type RecordSignupEventCommand = PlannedAccCommand<"ACC-013">;
export type RecordSignupEventResult = PlannedAccResult<"ACC-013">;
export function runACC013(_input: RecordSignupEventCommand): never {
  return notImplemented("ACC-013");
}
