/**
 * LIVE FAIL-CLOSED STUB for unsupported Teable ACC-023 branch, NOT a mock success.
 * Requirement: Attach local password to a provider-only account
 * Pinned source: bd8cfc054f521f6f9019f62dec2f9fcb1273ecec apps/nestjs-backend/src/features/auth/local-auth/local-auth.service.ts::LocalAuthService.addPassword
 * Owner: Identity, PR 7; gated acc.credentials.023=false-until-verified.
 * Tests: ACC-023-P/N/S/R/C planned; runtime disabled-branch test executable.
 * This module does NO SQL, Jazz, mail, grant, token, session or audit I/O.
 * Preserve already-working Dim0 passkey/link/consent branch independently.
 */
import { notImplemented, type PlannedAccCommand, type PlannedAccResult } from "../contracts.ts";
export type AddPasswordCommand = PlannedAccCommand<"ACC-023">;
export type AddPasswordResult = PlannedAccResult<"ACC-023">;
export function runACC023(_input: AddPasswordCommand): never {
  return notImplemented("ACC-023");
}
