/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-091 branch, NOT a mock success.
 * Requirement: Profile, password, change email, avatar, deletion UI
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nextjs-app/src/features/app/components/setting/account/ChangePasswordDialog.tsx::ChangePasswordDialog
 * Owner: Experience, PR 7; gated acc.ui.091=false-until-verified.
 * Tests: ACC-091-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type RenderAccountSettingsCommand = PlannedAccCommand<"ACC-091">;
export type RenderAccountSettingsResult = PlannedAccResult<"ACC-091">;
export function runACC091(_input: RenderAccountSettingsCommand): never {
  return notImplemented("ACC-091");
}
