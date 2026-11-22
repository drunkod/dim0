/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-004 branch, NOT a mock success.
 * Requirement: Verify and decrement waitlist invitation quota
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/user/user.service.ts::UserService.checkWaitlistInviteCode
 * Owner: Identity, PR 7; gated acc.registration.004=false-until-verified.
 * Tests: ACC-004-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type CheckWaitlistCodeCommand = PlannedAccCommand<"ACC-004">;
export type CheckWaitlistCodeResult = PlannedAccResult<"ACC-004">;
export function runACC004(_input: CheckWaitlistCodeCommand): never {
  return notImplemented("ACC-004");
}
