/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-010 branch, NOT a mock success.
 * Requirement: Claim pre-created invited identity on first real signup
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/auth/local-auth/local-auth.service.ts::LocalAuthService.signup
 * Owner: Identity, PR 7; gated account.email-invite=false.
 * Tests: ACC-010-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type ClaimInvitedUserCommand = PlannedAccCommand<"ACC-010">;
export type ClaimInvitedUserResult = PlannedAccResult<"ACC-010">;
export function runACC010(_input: ClaimInvitedUserCommand): never {
  return notImplemented("ACC-010");
}
