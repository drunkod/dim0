/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-044 branch, NOT a mock success.
 * Requirement: Scrub PII, credentials and retention metadata
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/user/delete-user/delete-user.service.ts::DeleteUserService.clearUserData
 * Owner: Lifecycle, PR 7; gated acc.lifecycle.044=false-until-verified.
 * Tests: ACC-044-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type AnonymizeDeletedAccountCommand = PlannedAccCommand<"ACC-044">;
export type AnonymizeDeletedAccountResult = PlannedAccResult<"ACC-044">;
export function runACC044(_input: AnonymizeDeletedAccountCommand): never {
  return notImplemented("ACC-044");
}
