/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-032 branch, NOT a mock success.
 * Requirement: Establish identity-bound session and audited login method
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/auth/session/session.service.ts::SessionService.recordSignin
 * Owner: Identity, PR 7; gated legacy.passkey-auth=existing-real; acc.teable-email-parity=false.
 * Tests: ACC-032-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type CreateSessionCommand = PlannedAccCommand<"ACC-032">;
export type CreateSessionResult = PlannedAccResult<"ACC-032">;
export function runACC032(_input: CreateSessionCommand): never {
  return notImplemented("ACC-032");
}
