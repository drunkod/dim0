/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-007 branch, NOT a mock success.
 * Requirement: Find user by normalized unique email without leaking existence publicly
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/user/user.service.ts::UserService.getUserByEmail
 * Owner: Identity, PR 7; gated acc.identity.007=false-until-verified.
 * Tests: ACC-007-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type GetUserByEmailCommand = PlannedAccCommand<"ACC-007">;
export type GetUserByEmailResult = PlannedAccResult<"ACC-007">;
export function runACC007(_input: GetUserByEmailCommand): never {
  return notImplemented("ACC-007");
}
