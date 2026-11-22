/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-026 branch, NOT a mock success.
 * Requirement: Verify login and establish browser session
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/auth/local-auth/local-auth.controller.ts::LocalAuthController.signin
 * Owner: Identity, PR 7; gated legacy.passkey-auth=existing-real; acc.teable-email-parity=false.
 * Tests: ACC-026-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type PasswordLoginCommand = PlannedAccCommand<"ACC-026">;
export type PasswordLoginResult = PlannedAccResult<"ACC-026">;
export function runACC026(_input: PasswordLoginCommand): never {
  return notImplemented("ACC-026");
}
