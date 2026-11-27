/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-040 branch, NOT a mock success.
 * Requirement: Update notification delivery choices
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/user/user.controller.ts::UserController.updateNotifyMeta
 * Owner: Experience, PR 7; gated acc.profile.040=false-until-verified.
 * Tests: ACC-040-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type SetNotificationPreferencesCommand = PlannedAccCommand<"ACC-040">;
export type SetNotificationPreferencesResult = PlannedAccResult<"ACC-040">;
export function runACC040(_input: SetNotificationPreferencesCommand): never {
  return notImplemented("ACC-040");
}
