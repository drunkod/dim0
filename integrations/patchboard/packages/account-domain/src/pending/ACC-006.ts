/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-006 branch, NOT a mock success.
 * Requirement: Create normalized unique email user, avatar, first admin and optional space
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/user/user.service.ts::UserService.createUser
 * Owner: Identity, PR 7; gated legacy.passkey-auth=existing-real; acc.teable-email-parity=false.
 * Tests: ACC-006-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type CreateUserCommand = PlannedAccCommand<"ACC-006">;
export type CreateUserResult = PlannedAccResult<"ACC-006">;
export function runACC006(_input: CreateUserCommand): never {
  return notImplemented("ACC-006");
}
