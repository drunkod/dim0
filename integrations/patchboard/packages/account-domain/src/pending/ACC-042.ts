/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-042 branch, NOT a mock success.
 * Requirement: Block deletion until sole owner resources resolved or acknowledged
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/user/delete-user/delete-user.service.ts::DeleteUserService.listSoleOwnerSpaces
 * Owner: Lifecycle, PR 7; gated acc.lifecycle.042=false-until-verified.
 * Tests: ACC-042-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type ListSoleOwnerSpacesCommand = PlannedAccCommand<"ACC-042">;
export type ListSoleOwnerSpacesResult = PlannedAccResult<"ACC-042">;
export function runACC042(_input: ListSoleOwnerSpacesCommand): never {
  return notImplemented("ACC-042");
}
