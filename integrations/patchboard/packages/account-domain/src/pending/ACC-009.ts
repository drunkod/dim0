/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-009 branch, NOT a mock success.
 * Requirement: Find provider identity by issuer-scoped subject or create/link user
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/user/user.service.ts::UserService.findOrCreateUser
 * Owner: Identity, PR 7; gated acc.identity.009=false-until-verified.
 * Tests: ACC-009-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type FindOrCreateProviderUserCommand = PlannedAccCommand<"ACC-009">;
export type FindOrCreateProviderUserResult = PlannedAccResult<"ACC-009">;
export function runACC009(_input: FindOrCreateProviderUserCommand): never {
  return notImplemented("ACC-009");
}
