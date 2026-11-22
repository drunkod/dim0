/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-036 branch, NOT a mock success.
 * Requirement: Single-session revocation with owner check
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/auth/session/session-store.service.ts::SessionStoreService.revokeSession
 * Owner: Identity, PR 7; gated acc.sessions.036=false-until-verified.
 * Tests: ACC-036-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type RevokeSessionCommand = PlannedAccCommand<"ACC-036">;
export type RevokeSessionResult = PlannedAccResult<"ACC-036">;
export function runACC036(_input: RevokeSessionCommand): never {
  return notImplemented("ACC-036");
}
