/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-037 branch, NOT a mock success.
 * Requirement: Update own public name via validated API
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/user/user.controller.ts::UserController.updateName
 * Owner: Experience, PR 7; gated acc.profile.037=false-until-verified.
 * Tests: ACC-037-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type UpdateDisplayNameCommand = PlannedAccCommand<"ACC-037">;
export type UpdateDisplayNameResult = PlannedAccResult<"ACC-037">;
export function runACC037(_input: UpdateDisplayNameCommand): never {
  return notImplemented("ACC-037");
}
