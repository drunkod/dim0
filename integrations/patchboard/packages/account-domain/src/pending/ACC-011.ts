/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-011 branch, NOT a mock success.
 * Requirement: Link provider to existing user without refiring signup event
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/user/user.service.ts::UserService.findOrCreateUser
 * Owner: Identity, PR 7; gated acc.identity.011=false-until-verified.
 * Tests: ACC-011-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type LinkExternalAccountCommand = PlannedAccCommand<"ACC-011">;
export type LinkExternalAccountResult = PlannedAccResult<"ACC-011">;
export function runACC011(_input: LinkExternalAccountCommand): never {
  return notImplemented("ACC-011");
}
