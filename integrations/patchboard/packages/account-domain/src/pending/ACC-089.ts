/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-089 branch, NOT a mock success.
 * Requirement: Banned domain and risk filtering on signup and invitations
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/user/user.service.ts::UserService.throwIfEmailDomainBanned
 * Owner: Identity + Platform, PR 1; gated acc.security.089=false-until-verified.
 * Tests: ACC-089-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type FilterBlockedEmailsCommand = PlannedAccCommand<"ACC-089">;
export type FilterBlockedEmailsResult = PlannedAccResult<"ACC-089">;
export function runACC089(_input: FilterBlockedEmailsCommand): never {
  return notImplemented("ACC-089");
}
