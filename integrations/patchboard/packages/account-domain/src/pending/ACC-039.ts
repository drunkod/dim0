/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-039 branch, NOT a mock success.
 * Requirement: Update user locale
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/user/user.controller.ts::UserController.updateLang
 * Owner: Experience, PR 7; gated acc.profile.039=false-until-verified.
 * Tests: ACC-039-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type SetLanguageCommand = PlannedAccCommand<"ACC-039">;
export type SetLanguageResult = PlannedAccResult<"ACC-039">;
export function runACC039(_input: SetLanguageCommand): never {
  return notImplemented("ACC-039");
}
