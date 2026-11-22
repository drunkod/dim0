/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-008 branch, NOT a mock success.
 * Requirement: Get user by stable internal ID and correct privacy projection
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/user/user.service.ts::UserService.getUserById
 * Owner: Identity, PR 7; gated acc.identity.008=false-until-verified.
 * Tests: ACC-008-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type GetUserByIdCommand = PlannedAccCommand<"ACC-008">;
export type GetUserByIdResult = PlannedAccResult<"ACC-008">;
export function runACC008(_input: GetUserByIdCommand): never {
  return notImplemented("ACC-008");
}
