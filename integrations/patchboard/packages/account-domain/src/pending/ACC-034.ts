/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-034 branch, NOT a mock success.
 * Requirement: Revoke all sessions after critical credential change
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/auth/session/session-store.service.ts::SessionStoreService.clearByUserId
 * Owner: Identity, PR 7; gated acc.sessions.034=false-until-verified.
 * Tests: ACC-034-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type RevokeAllSessionsCommand = PlannedAccCommand<"ACC-034">;
export type RevokeAllSessionsResult = PlannedAccResult<"ACC-034">;
export function runACC034(_input: RevokeAllSessionsCommand): never {
  return notImplemented("ACC-034");
}
