/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-093 branch, NOT a mock success.
 * Requirement: Login, signup, reset and verification screens
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nextjs-app/src/features/auth/pages/LoginPage.tsx::LoginPage
 * Owner: Experience, PR 7; gated legacy.passkey-auth=existing-real; acc.teable-email-parity=false.
 * Tests: ACC-093-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type RenderAuthPagesCommand = PlannedAccCommand<"ACC-093">;
export type RenderAuthPagesResult = PlannedAccResult<"ACC-093">;
export function runACC093(_input: RenderAuthPagesCommand): never {
  return notImplemented("ACC-093");
}
