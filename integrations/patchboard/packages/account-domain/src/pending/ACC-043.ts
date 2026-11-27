/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-043 branch, NOT a mock success.
 * Requirement: Delete account safely and preserve history and ownership invariants
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/user/delete-user/delete-user.service.ts::DeleteUserService.deleteUser
 * Owner: Lifecycle, PR 7; gated acc.lifecycle.043=false-until-verified.
 * Tests: ACC-043-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type DeleteAccountCommand = PlannedAccCommand<"ACC-043">;
export type DeleteAccountResult = PlannedAccResult<"ACC-043">;
export function runACC043(_input: DeleteAccountCommand): never {
  return notImplemented("ACC-043");
}
