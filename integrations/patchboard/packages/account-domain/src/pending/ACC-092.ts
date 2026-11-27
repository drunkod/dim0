/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-092 branch, NOT a mock success.
 * Requirement: Invite and role editing UI, permission warnings
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nextjs-app/src/features/app/components/collaborator-manage/components/RoleSelect.tsx::RoleSelect
 * Owner: Experience, PR 7; gated acc.ui.092=false-until-verified.
 * Tests: ACC-092-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type RenderMemberAdminCommand = PlannedAccCommand<"ACC-092">;
export type RenderMemberAdminResult = PlannedAccResult<"ACC-092">;
export function runACC092(_input: RenderMemberAdminCommand): never {
  return notImplemented("ACC-092");
}
