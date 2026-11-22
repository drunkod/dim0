/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-041 branch, NOT a mock success.
 * Requirement: Track accessible last visited boards/spaces
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/user/last-visit/last-visit.service.ts::LastVisitService.updateUserLastVisit
 * Owner: Experience, PR 7; gated acc.profile.041=false-until-verified.
 * Tests: ACC-041-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type RecordLastVisitedCommand = PlannedAccCommand<"ACC-041">;
export type RecordLastVisitedResult = PlannedAccResult<"ACC-041">;
export function runACC041(_input: RecordLastVisitedCommand): never {
  return notImplemented("ACC-041");
}
