/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-035 branch, NOT a mock success.
 * Requirement: List only subject's sessions with privacy fields
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/auth/session/session-store.service.ts::SessionStoreService.listByUserId
 * Owner: Identity, PR 7; gated acc.sessions.035=false-until-verified.
 * Tests: ACC-035-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type ListSessionsCommand = PlannedAccCommand<"ACC-035">;
export type ListSessionsResult = PlannedAccResult<"ACC-035">;
export function runACC035(_input: ListSessionsCommand): never {
  return notImplemented("ACC-035");
}
