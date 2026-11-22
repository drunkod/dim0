/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-045 branch, NOT a mock success.
 * Requirement: Delete PAT, linked accounts and app grants upon deletion
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/user/delete-user/delete-user.service.ts::DeleteUserService.clearUserData
 * Owner: Lifecycle, PR 7; gated acc.lifecycle.045=false-until-verified.
 * Tests: ACC-045-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type RevokeAccountTokensCommand = PlannedAccCommand<"ACC-045">;
export type RevokeAccountTokensResult = PlannedAccResult<"ACC-045">;
export function runACC045(_input: RevokeAccountTokensCommand): never {
  return notImplemented("ACC-045");
}
